use std::collections::BTreeMap;
use std::error::Error;
use std::fmt::{Display, Formatter};

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct DeviceId(String);

impl DeviceId {
    pub fn new(value: impl Into<String>) -> Result<Self, DeviceError> {
        let value = value.into();
        let value = value.trim();
        if value.is_empty() {
            return Err(DeviceError::EmptyDeviceId);
        }
        Ok(Self(value.to_owned()))
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl Display for DeviceId {
    fn fmt(&self, f: &mut Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum DeviceFlow {
    Capture,
    Render,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum DeviceRole {
    Console,
    Multimedia,
    Communications,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DeviceState {
    Active,
    Disabled,
    NotPresent,
    Unplugged,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DeviceDescriptor {
    pub id: DeviceId,
    pub name: String,
    pub flow: DeviceFlow,
    pub state: DeviceState,
}

impl DeviceDescriptor {
    pub fn new(
        id: DeviceId,
        name: impl Into<String>,
        flow: DeviceFlow,
        state: DeviceState,
    ) -> Result<Self, DeviceError> {
        let name = name.into();
        let name = name.trim();
        if name.is_empty() {
            return Err(DeviceError::EmptyDeviceName);
        }
        Ok(Self {
            id,
            name: name.to_owned(),
            flow,
            state,
        })
    }

    pub fn is_usable(&self) -> bool {
        self.state == DeviceState::Active
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DeviceError {
    EmptyDeviceId,
    EmptyDeviceName,
    UnknownDevice(DeviceId),
    FlowMismatch {
        id: DeviceId,
        expected: DeviceFlow,
        actual: DeviceFlow,
    },
}

impl Display for DeviceError {
    fn fmt(&self, f: &mut Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::EmptyDeviceId => f.write_str("audio device id must not be empty"),
            Self::EmptyDeviceName => f.write_str("audio device name must not be empty"),
            Self::UnknownDevice(id) => write!(f, "unknown audio device: {id}"),
            Self::FlowMismatch {
                id,
                expected,
                actual,
            } => write!(
                f,
                "audio device {id} has flow {actual:?}, expected {expected:?}"
            ),
        }
    }
}

impl Error for DeviceError {}

#[derive(Debug, Default, Clone)]
pub struct DeviceCatalog {
    devices: BTreeMap<DeviceId, DeviceDescriptor>,
    defaults: BTreeMap<(DeviceFlow, DeviceRole), DeviceId>,
}

impl DeviceCatalog {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn upsert(&mut self, descriptor: DeviceDescriptor) {
        self.devices.insert(descriptor.id.clone(), descriptor);
    }

    pub fn remove(&mut self, id: &DeviceId) -> Option<DeviceDescriptor> {
        self.defaults.retain(|_, default_id| default_id != id);
        self.devices.remove(id)
    }

    pub fn set_state(&mut self, id: &DeviceId, state: DeviceState) -> Result<(), DeviceError> {
        let descriptor = self
            .devices
            .get_mut(id)
            .ok_or_else(|| DeviceError::UnknownDevice(id.clone()))?;
        descriptor.state = state;
        Ok(())
    }

    pub fn set_default(
        &mut self,
        flow: DeviceFlow,
        role: DeviceRole,
        id: Option<DeviceId>,
    ) -> Result<(), DeviceError> {
        let key = (flow, role);
        let Some(id) = id else {
            self.defaults.remove(&key);
            return Ok(());
        };

        let descriptor = self
            .devices
            .get(&id)
            .ok_or_else(|| DeviceError::UnknownDevice(id.clone()))?;
        if descriptor.flow != flow {
            return Err(DeviceError::FlowMismatch {
                id,
                expected: flow,
                actual: descriptor.flow,
            });
        }

        self.defaults.insert(key, descriptor.id.clone());
        Ok(())
    }

    pub fn get(&self, id: &DeviceId) -> Option<&DeviceDescriptor> {
        self.devices.get(id)
    }

    pub fn default_for(&self, flow: DeviceFlow, role: DeviceRole) -> Option<&DeviceDescriptor> {
        self.defaults
            .get(&(flow, role))
            .and_then(|id| self.devices.get(id))
    }

    pub fn select(
        &self,
        flow: DeviceFlow,
        role: DeviceRole,
        preferred: Option<&DeviceId>,
    ) -> Option<&DeviceDescriptor> {
        if let Some(preferred) = preferred
            && let Some(descriptor) = self.devices.get(preferred)
            && descriptor.flow == flow
            && descriptor.is_usable()
        {
            return Some(descriptor);
        }

        if let Some(default) = self.default_for(flow, role)
            && default.is_usable()
        {
            return Some(default);
        }

        self.devices
            .values()
            .find(|descriptor| descriptor.flow == flow && descriptor.is_usable())
    }

    pub fn active_devices(&self, flow: DeviceFlow) -> Vec<&DeviceDescriptor> {
        self.devices
            .values()
            .filter(|descriptor| descriptor.flow == flow && descriptor.is_usable())
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn id(value: &str) -> DeviceId {
        DeviceId::new(value).expect("valid device id")
    }

    fn device(value: &str, flow: DeviceFlow, state: DeviceState) -> DeviceDescriptor {
        DeviceDescriptor::new(id(value), value, flow, state).expect("valid device")
    }

    #[test]
    fn rejects_empty_identifiers_and_names() {
        assert_eq!(DeviceId::new("  "), Err(DeviceError::EmptyDeviceId));
        assert_eq!(
            DeviceDescriptor::new(id("mic"), " ", DeviceFlow::Capture, DeviceState::Active),
            Err(DeviceError::EmptyDeviceName)
        );
    }

    #[test]
    fn selects_active_preferred_device_before_default() {
        let mut catalog = DeviceCatalog::new();
        catalog.upsert(device("mic-a", DeviceFlow::Capture, DeviceState::Active));
        catalog.upsert(device("mic-b", DeviceFlow::Capture, DeviceState::Active));
        catalog
            .set_default(
                DeviceFlow::Capture,
                DeviceRole::Communications,
                Some(id("mic-a")),
            )
            .expect("set default");

        let selected = catalog
            .select(
                DeviceFlow::Capture,
                DeviceRole::Communications,
                Some(&id("mic-b")),
            )
            .expect("selected device");

        assert_eq!(selected.id, id("mic-b"));
    }

    #[test]
    fn falls_back_to_default_when_preferred_is_unplugged() {
        let mut catalog = DeviceCatalog::new();
        catalog.upsert(device("mic-a", DeviceFlow::Capture, DeviceState::Active));
        catalog.upsert(device("mic-b", DeviceFlow::Capture, DeviceState::Unplugged));
        catalog
            .set_default(
                DeviceFlow::Capture,
                DeviceRole::Communications,
                Some(id("mic-a")),
            )
            .expect("set default");

        let selected = catalog
            .select(
                DeviceFlow::Capture,
                DeviceRole::Communications,
                Some(&id("mic-b")),
            )
            .expect("selected device");

        assert_eq!(selected.id, id("mic-a"));
    }

    #[test]
    fn falls_back_deterministically_when_default_is_unavailable() {
        let mut catalog = DeviceCatalog::new();
        catalog.upsert(device("mic-z", DeviceFlow::Capture, DeviceState::Active));
        catalog.upsert(device("mic-a", DeviceFlow::Capture, DeviceState::Active));
        catalog.upsert(device("speaker", DeviceFlow::Render, DeviceState::Active));

        let selected = catalog
            .select(DeviceFlow::Capture, DeviceRole::Communications, None)
            .expect("selected device");

        assert_eq!(selected.id, id("mic-a"));
    }

    #[test]
    fn removing_device_clears_default_reference() {
        let mut catalog = DeviceCatalog::new();
        catalog.upsert(device("mic", DeviceFlow::Capture, DeviceState::Active));
        catalog
            .set_default(
                DeviceFlow::Capture,
                DeviceRole::Communications,
                Some(id("mic")),
            )
            .expect("set default");

        catalog.remove(&id("mic"));

        assert!(
            catalog
                .default_for(DeviceFlow::Capture, DeviceRole::Communications)
                .is_none()
        );
    }

    #[test]
    fn refuses_default_device_from_wrong_flow() {
        let mut catalog = DeviceCatalog::new();
        catalog.upsert(device("speaker", DeviceFlow::Render, DeviceState::Active));

        let error = catalog
            .set_default(
                DeviceFlow::Capture,
                DeviceRole::Communications,
                Some(id("speaker")),
            )
            .expect_err("flow mismatch must fail");

        assert_eq!(
            error,
            DeviceError::FlowMismatch {
                id: id("speaker"),
                expected: DeviceFlow::Capture,
                actual: DeviceFlow::Render,
            }
        );
    }

    #[test]
    fn inactive_default_falls_back_to_active_device() {
        let mut catalog = DeviceCatalog::new();
        catalog.upsert(device("mic-a", DeviceFlow::Capture, DeviceState::Active));
        catalog.upsert(device("mic-b", DeviceFlow::Capture, DeviceState::Active));
        catalog
            .set_default(
                DeviceFlow::Capture,
                DeviceRole::Communications,
                Some(id("mic-b")),
            )
            .expect("set default");
        catalog
            .set_state(&id("mic-b"), DeviceState::Disabled)
            .expect("set state");

        let selected = catalog
            .select(DeviceFlow::Capture, DeviceRole::Communications, None)
            .expect("fallback device");

        assert_eq!(selected.id, id("mic-a"));
    }
}
