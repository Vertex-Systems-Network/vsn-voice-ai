use std::error::Error;
use std::fmt::{Display, Formatter};

use crate::sample_decode::{NativeSampleEncoding, SampleDecodeError};

pub const WAVE_FORMAT_PCM_TAG: u16 = 0x0001;
pub const WAVE_FORMAT_IEEE_FLOAT_TAG: u16 = 0x0003;
pub const WAVE_FORMAT_EXTENSIBLE_TAG: u16 = 0xfffe;
pub const WAVE_FORMAT_EXTENSIBLE_EXTRA_BYTES: u16 = 22;

pub const PCM_SUBFORMAT_GUID: u128 = 0x00000001_0000_0010_8000_00aa00389b71;
pub const IEEE_FLOAT_SUBFORMAT_GUID: u128 = 0x00000003_0000_0010_8000_00aa00389b71;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ExtensibleWaveFormat {
    pub valid_bits_per_sample: u16,
    pub sub_format_guid: u128,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct WaveFormatDescriptor {
    pub format_tag: u16,
    pub bits_per_sample: u16,
    pub extra_size: u16,
    pub extensible: Option<ExtensibleWaveFormat>,
}

impl WaveFormatDescriptor {
    pub fn native_sample_encoding(self) -> Result<NativeSampleEncoding, WaveFormatError> {
        match self.format_tag {
            WAVE_FORMAT_PCM_TAG => validated_pcm(self.bits_per_sample, self.bits_per_sample),
            WAVE_FORMAT_IEEE_FLOAT_TAG => validated_float(self.bits_per_sample),
            WAVE_FORMAT_EXTENSIBLE_TAG => self.extensible_encoding(),
            tag => Err(WaveFormatError::UnsupportedFormatTag(tag)),
        }
    }

    fn extensible_encoding(self) -> Result<NativeSampleEncoding, WaveFormatError> {
        if self.extra_size < WAVE_FORMAT_EXTENSIBLE_EXTRA_BYTES {
            return Err(WaveFormatError::ExtensiblePayloadTooSmall {
                actual: self.extra_size,
                required: WAVE_FORMAT_EXTENSIBLE_EXTRA_BYTES,
            });
        }
        let extensible = self
            .extensible
            .ok_or(WaveFormatError::MissingExtensibleDescriptor)?;

        match extensible.sub_format_guid {
            PCM_SUBFORMAT_GUID => validated_pcm(
                self.bits_per_sample,
                extensible.valid_bits_per_sample,
            ),
            IEEE_FLOAT_SUBFORMAT_GUID => validated_float(self.bits_per_sample),
            guid => Err(WaveFormatError::UnsupportedSubFormat(guid)),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum WaveFormatError {
    UnsupportedFormatTag(u16),
    ExtensiblePayloadTooSmall { actual: u16, required: u16 },
    MissingExtensibleDescriptor,
    UnsupportedSubFormat(u128),
    UnsupportedFloatBits(u16),
    InvalidEncoding(SampleDecodeError),
}

impl Display for WaveFormatError {
    fn fmt(&self, f: &mut Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::UnsupportedFormatTag(tag) => {
                write!(f, "unsupported Windows wave format tag: 0x{tag:04x}")
            }
            Self::ExtensiblePayloadTooSmall { actual, required } => write!(
                f,
                "WAVEFORMATEXTENSIBLE payload is too small: cbSize={actual}, requires at least {required}"
            ),
            Self::MissingExtensibleDescriptor => {
                f.write_str("WAVE_FORMAT_EXTENSIBLE requires an extensible descriptor")
            }
            Self::UnsupportedSubFormat(guid) => {
                write!(f, "unsupported WAVEFORMATEXTENSIBLE subformat GUID: {guid:032x}")
            }
            Self::UnsupportedFloatBits(bits) => {
                write!(f, "unsupported IEEE float sample width: {bits} bits")
            }
            Self::InvalidEncoding(error) => write!(f, "invalid native sample encoding: {error}"),
        }
    }
}

impl Error for WaveFormatError {}

impl From<SampleDecodeError> for WaveFormatError {
    fn from(value: SampleDecodeError) -> Self {
        Self::InvalidEncoding(value)
    }
}

fn validated_pcm(
    container_bits: u16,
    valid_bits: u16,
) -> Result<NativeSampleEncoding, WaveFormatError> {
    let encoding = NativeSampleEncoding::Pcm {
        container_bits,
        valid_bits,
    };
    encoding.bytes_per_sample()?;
    Ok(encoding)
}

fn validated_float(bits_per_sample: u16) -> Result<NativeSampleEncoding, WaveFormatError> {
    if bits_per_sample != 32 {
        return Err(WaveFormatError::UnsupportedFloatBits(bits_per_sample));
    }
    Ok(NativeSampleEncoding::Float32)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_classic_pcm_and_float_formats() {
        let pcm = WaveFormatDescriptor {
            format_tag: WAVE_FORMAT_PCM_TAG,
            bits_per_sample: 16,
            extra_size: 0,
            extensible: None,
        };
        assert_eq!(
            pcm.native_sample_encoding(),
            Ok(NativeSampleEncoding::Pcm {
                container_bits: 16,
                valid_bits: 16
            })
        );

        let float = WaveFormatDescriptor {
            format_tag: WAVE_FORMAT_IEEE_FLOAT_TAG,
            bits_per_sample: 32,
            extra_size: 0,
            extensible: None,
        };
        assert_eq!(
            float.native_sample_encoding(),
            Ok(NativeSampleEncoding::Float32)
        );
    }

    #[test]
    fn maps_extensible_pcm_with_reduced_valid_precision() {
        let descriptor = WaveFormatDescriptor {
            format_tag: WAVE_FORMAT_EXTENSIBLE_TAG,
            bits_per_sample: 32,
            extra_size: WAVE_FORMAT_EXTENSIBLE_EXTRA_BYTES,
            extensible: Some(ExtensibleWaveFormat {
                valid_bits_per_sample: 24,
                sub_format_guid: PCM_SUBFORMAT_GUID,
            }),
        };

        assert_eq!(
            descriptor.native_sample_encoding(),
            Ok(NativeSampleEncoding::Pcm {
                container_bits: 32,
                valid_bits: 24
            })
        );
    }

    #[test]
    fn maps_extensible_float32() {
        let descriptor = WaveFormatDescriptor {
            format_tag: WAVE_FORMAT_EXTENSIBLE_TAG,
            bits_per_sample: 32,
            extra_size: WAVE_FORMAT_EXTENSIBLE_EXTRA_BYTES,
            extensible: Some(ExtensibleWaveFormat {
                valid_bits_per_sample: 32,
                sub_format_guid: IEEE_FLOAT_SUBFORMAT_GUID,
            }),
        };

        assert_eq!(
            descriptor.native_sample_encoding(),
            Ok(NativeSampleEncoding::Float32)
        );
    }

    #[test]
    fn rejects_short_or_unknown_extensible_formats() {
        let short = WaveFormatDescriptor {
            format_tag: WAVE_FORMAT_EXTENSIBLE_TAG,
            bits_per_sample: 32,
            extra_size: 10,
            extensible: None,
        };
        assert!(matches!(
            short.native_sample_encoding(),
            Err(WaveFormatError::ExtensiblePayloadTooSmall { .. })
        ));

        let unknown = WaveFormatDescriptor {
            format_tag: WAVE_FORMAT_EXTENSIBLE_TAG,
            bits_per_sample: 32,
            extra_size: WAVE_FORMAT_EXTENSIBLE_EXTRA_BYTES,
            extensible: Some(ExtensibleWaveFormat {
                valid_bits_per_sample: 32,
                sub_format_guid: 0x11111111_2222_3333_4444_555555555555,
            }),
        };
        assert!(matches!(
            unknown.native_sample_encoding(),
            Err(WaveFormatError::UnsupportedSubFormat(_))
        ));
    }

    #[test]
    fn rejects_invalid_pcm_and_non_float32_widths() {
        let invalid_pcm = WaveFormatDescriptor {
            format_tag: WAVE_FORMAT_PCM_TAG,
            bits_per_sample: 20,
            extra_size: 0,
            extensible: None,
        };
        assert!(matches!(
            invalid_pcm.native_sample_encoding(),
            Err(WaveFormatError::InvalidEncoding(
                SampleDecodeError::UnsupportedPcmContainerBits(20)
            ))
        ));

        let float64 = WaveFormatDescriptor {
            format_tag: WAVE_FORMAT_IEEE_FLOAT_TAG,
            bits_per_sample: 64,
            extra_size: 0,
            extensible: None,
        };
        assert_eq!(
            float64.native_sample_encoding(),
            Err(WaveFormatError::UnsupportedFloatBits(64))
        );
    }
}
