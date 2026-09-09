use crate::device::{
    DeviceCatalog, DeviceDescriptor, DeviceError, DeviceFlow, DeviceId, DeviceRole, DeviceState,
};

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DeviceEvent {
    Upserted(DeviceDescriptor),
    Removed(DeviceId),
    StateChanged {
        id: DeviceId,
        state: DeviceState,
    },
    DefaultChanged {
        flow: DeviceFlow,
        role: DeviceRole,
        id: Option<DeviceId>,
    },
    PreferredChanged(Option<DeviceId>),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SelectionChange {
    pub previous: Option<DeviceId>,
    pub current: Option<DeviceId>,
    pub changed: bool,
}

#[derive(Debug, Clone)]
pub struct DeviceSelectionController {
    catalog: DeviceCatalog,
    flow: DeviceFlow,
    role: DeviceRole,
    preferred: Option<DeviceId>,
    current: Option<DeviceId>,
}

impl DeviceSelectionController {
    pub fn new(
        catalog: DeviceCatalog,
        flow: DeviceFlow,
        role: DeviceRole,
        preferred: Option<DeviceId>,
    ) -> Self {
        let current = catalog
            .select(flow, role, preferred.as_ref())
            .map(|descriptor| descriptor.id.clone());
        Self {
            catalog,
            flow,
            role,
            preferred,
            current,
        }
    }

    pub fn catalog(&self) -> &DeviceCatalog {
        &self.catalog
    }

    pub fn preferred(&self) -> Option<&DeviceId> {
        self.preferred.as_ref()
    }

    pub fn current(&self) -> Option<&DeviceId> {
        self.current.as_ref()
    }

    pub fn apply(&mut self, event: DeviceEvent) -> Result<SelectionChange, DeviceError> {
        let previous = self.current.clone();

        match event {
            DeviceEvent::Upserted(descriptor) => self.catalog.upsert(descriptor),
            DeviceEvent::Removed(id) => {
                self.catalog.remove(&id);
            }
            DeviceEvent::StateChanged { id, state } => {
                self.catalog.set_state(&id, state)?;
            }
            DeviceEvent::DefaultChanged { flow, role, id } => {
                self.catalog.set_default(flow, role, id)?;
            }
            DeviceEvent::PreferredChanged(id) => {
                self.preferred = id;
            }
        }

        self.current = self.resolve();

        Ok(SelectionChange {
            changed: previous != self.current,
            previous,
            current: self.current.clone(),
        })
    }

    fn resolve(&self) -> Option<DeviceId> {
        self.catalog
            .select(self.flow, self.role, self.preferred.as_ref())
            .map(|descriptor| descriptor.id.clone())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn id(value: &str) -> DeviceId {
        DeviceId::new(value).expect("valid id")
    }

    fn device(value: &str, state: DeviceState) -> DeviceDescriptor {
        DeviceDescriptor::new(id(value), value, DeviceFlow::Capture, state).expect("valid device")
    }

    fn catalog_with_default() -> DeviceCatalog {
        let mut catalog = DeviceCatalog::new();
        catalog.upsert(device("mic-a", DeviceState::Active));
        catalog.upsert(device("mic-b", DeviceState::Active));
        catalog
            .set_default(
                DeviceFlow::Capture,
                DeviceRole::Communications,
                Some(id("mic-a")),
            )
            .expect("set default");
        catalog
    }

    #[test]
    fn unplugged_preferred_device_switches_to_default() {
        let mut controller = DeviceSelectionController::new(
            catalog_with_default(),
            DeviceFlow::Capture,
            DeviceRole::Communications,
            Some(id("mic-b")),
        );
        assert_eq!(controller.current(), Some(&id("mic-b")));

        let change = controller
            .apply(DeviceEvent::StateChanged {
                id: id("mic-b"),
                state: DeviceState::Unplugged,
            })
            .expect("apply event");

        assert!(change.changed);
        assert_eq!(change.previous, Some(id("mic-b")));
        assert_eq!(change.current, Some(id("mic-a")));
    }

    #[test]
    fn default_change_switches_when_no_preference_exists() {
        let mut controller = DeviceSelectionController::new(
            catalog_with_default(),
            DeviceFlow::Capture,
            DeviceRole::Communications,
            None,
        );
        assert_eq!(controller.current(), Some(&id("mic-a")));

        let change = controller
            .apply(DeviceEvent::DefaultChanged {
                flow: DeviceFlow::Capture,
                role: DeviceRole::Communications,
                id: Some(id("mic-b")),
            })
            .expect("apply event");

        assert!(change.changed);
        assert_eq!(change.current, Some(id("mic-b")));
    }

    #[test]
    fn preferred_device_reclaims_selection_when_it_becomes_active() {
        let mut catalog = DeviceCatalog::new();
        catalog.upsert(device("mic-a", DeviceState::Active));
        catalog
            .set_default(
                DeviceFlow::Capture,
                DeviceRole::Communications,
                Some(id("mic-a")),
            )
            .expect("set default");

        let mut controller = DeviceSelectionController::new(
            catalog,
            DeviceFlow::Capture,
            DeviceRole::Communications,
            Some(id("mic-b")),
        );
        assert_eq!(controller.current(), Some(&id("mic-a")));

        let change = controller
            .apply(DeviceEvent::Upserted(device(
                "mic-b",
                DeviceState::Active,
            )))
            .expect("apply event");

        assert!(change.changed);
        assert_eq!(change.current, Some(id("mic-b")));
    }

    #[test]
    fn removing_only_device_transitions_to_no_input() {
        let mut catalog = DeviceCatalog::new();
        catalog.upsert(device("mic", DeviceState::Active));
        let mut controller = DeviceSelectionController::new(
            catalog,
            DeviceFlow::Capture,
            DeviceRole::Communications,
            None,
        );

        let change = controller
            .apply(DeviceEvent::Removed(id("mic")))
            .expect("apply event");

        assert!(change.changed);
        assert_eq!(change.previous, Some(id("mic")));
        assert_eq!(change.current, None);
    }

    #[test]
    fn changing_preference_reselects_immediately() {
        let mut controller = DeviceSelectionController::new(
            catalog_with_default(),
            DeviceFlow::Capture,
            DeviceRole::Communications,
            None,
        );

        let change = controller
            .apply(DeviceEvent::PreferredChanged(Some(id("mic-b"))))
            .expect("apply event");

        assert!(change.changed);
        assert_eq!(controller.preferred(), Some(&id("mic-b")));
        assert_eq!(change.current, Some(id("mic-b")));
    }

    #[test]
    fn unrelated_render_default_change_does_not_change_capture_selection() {
        let mut catalog = catalog_with_default();
        catalog.upsert(
            DeviceDescriptor::new(
                id("speaker"),
                "speaker",
                DeviceFlow::Render,
                DeviceState::Active,
            )
            .expect("valid speaker"),
        );
        let mut controller = DeviceSelectionController::new(
            catalog,
            DeviceFlow::Capture,
            DeviceRole::Communications,
            None,
        );

        let change = controller
            .apply(DeviceEvent::DefaultChanged {
                flow: DeviceFlow::Render,
                role: DeviceRole::Communications,
                id: Some(id("speaker")),
            })
            .expect("apply event");

        assert!(!change.changed);
        assert_eq!(change.current, Some(id("mic-a")));
    }
}
