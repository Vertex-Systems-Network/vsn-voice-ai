use std::error::Error;
use std::fmt::{Display, Formatter};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NativeSampleEncoding {
    Pcm {
        container_bits: u16,
        valid_bits: u16,
    },
    Float32,
}

impl NativeSampleEncoding {
    pub fn bytes_per_sample(self) -> Result<usize, SampleDecodeError> {
        match self {
            Self::Float32 => Ok(4),
            Self::Pcm {
                container_bits,
                valid_bits,
            } => {
                validate_pcm_bits(container_bits, valid_bits)?;
                Ok(usize::from(container_bits / 8))
            }
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SampleDecodeError {
    ChannelCountZero,
    UnsupportedPcmContainerBits(u16),
    InvalidValidBits {
        container_bits: u16,
        valid_bits: u16,
    },
    FrameByteCountOverflow,
    MisalignedInput {
        frame_bytes: usize,
        actual_bytes: usize,
    },
    NonFiniteFloat {
        sample_index: usize,
    },
}

impl Display for SampleDecodeError {
    fn fmt(&self, f: &mut Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::ChannelCountZero => {
                f.write_str("native sample decoder channel count must be non-zero")
            }
            Self::UnsupportedPcmContainerBits(bits) => {
                write!(f, "unsupported PCM container width: {bits} bits")
            }
            Self::InvalidValidBits {
                container_bits,
                valid_bits,
            } => write!(
                f,
                "invalid PCM precision: {valid_bits} valid bits in {container_bits}-bit container"
            ),
            Self::FrameByteCountOverflow => f.write_str("native frame byte count overflow"),
            Self::MisalignedInput {
                frame_bytes,
                actual_bytes,
            } => write!(
                f,
                "native sample bytes are not frame-aligned: {actual_bytes} bytes for {frame_bytes}-byte frames"
            ),
            Self::NonFiniteFloat { sample_index } => {
                write!(f, "non-finite float sample at index {sample_index}")
            }
        }
    }
}

impl Error for SampleDecodeError {}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SampleDecoder {
    encoding: NativeSampleEncoding,
    channels: u16,
    bytes_per_sample: usize,
    frame_bytes: usize,
}

impl SampleDecoder {
    pub fn new(encoding: NativeSampleEncoding, channels: u16) -> Result<Self, SampleDecodeError> {
        if channels == 0 {
            return Err(SampleDecodeError::ChannelCountZero);
        }
        let bytes_per_sample = encoding.bytes_per_sample()?;
        let frame_bytes = bytes_per_sample
            .checked_mul(usize::from(channels))
            .ok_or(SampleDecodeError::FrameByteCountOverflow)?;

        Ok(Self {
            encoding,
            channels,
            bytes_per_sample,
            frame_bytes,
        })
    }

    pub fn encoding(self) -> NativeSampleEncoding {
        self.encoding
    }

    pub fn channels(self) -> u16 {
        self.channels
    }

    pub fn frame_bytes(self) -> usize {
        self.frame_bytes
    }

    pub fn decode_interleaved(self, bytes: &[u8]) -> Result<Vec<f32>, SampleDecodeError> {
        if !bytes.len().is_multiple_of(self.frame_bytes) {
            return Err(SampleDecodeError::MisalignedInput {
                frame_bytes: self.frame_bytes,
                actual_bytes: bytes.len(),
            });
        }

        let sample_count = bytes.len() / self.bytes_per_sample;
        let mut samples = Vec::with_capacity(sample_count);
        for (sample_index, sample_bytes) in bytes.chunks_exact(self.bytes_per_sample).enumerate() {
            let sample = match self.encoding {
                NativeSampleEncoding::Float32 => decode_float32(sample_bytes, sample_index)?,
                NativeSampleEncoding::Pcm {
                    container_bits,
                    valid_bits,
                } => decode_pcm(sample_bytes, container_bits, valid_bits),
            };
            samples.push(sample);
        }
        Ok(samples)
    }
}

fn validate_pcm_bits(container_bits: u16, valid_bits: u16) -> Result<(), SampleDecodeError> {
    if !matches!(container_bits, 16 | 24 | 32) {
        return Err(SampleDecodeError::UnsupportedPcmContainerBits(
            container_bits,
        ));
    }
    if valid_bits == 0 || valid_bits > container_bits {
        return Err(SampleDecodeError::InvalidValidBits {
            container_bits,
            valid_bits,
        });
    }
    Ok(())
}

fn decode_float32(bytes: &[u8], sample_index: usize) -> Result<f32, SampleDecodeError> {
    let sample = f32::from_le_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]);
    if !sample.is_finite() {
        return Err(SampleDecodeError::NonFiniteFloat { sample_index });
    }
    Ok(sample)
}

fn decode_pcm(bytes: &[u8], container_bits: u16, valid_bits: u16) -> f32 {
    let container_value = match container_bits {
        16 => i32::from(i16::from_le_bytes([bytes[0], bytes[1]])),
        24 => {
            let raw =
                u32::from(bytes[0]) | (u32::from(bytes[1]) << 8) | (u32::from(bytes[2]) << 16);
            if raw & 0x0080_0000 != 0 {
                (raw | 0xff00_0000) as i32
            } else {
                raw as i32
            }
        }
        32 => i32::from_le_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]),
        _ => unreachable!("PCM container width is validated by SampleDecoder::new"),
    };

    let shift = u32::from(container_bits - valid_bits);
    let value = container_value >> shift;
    let scale = (1u64 << u32::from(valid_bits - 1)) as f32;
    value as f32 / scale
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decodes_pcm16_extremes_and_zero() {
        let decoder = SampleDecoder::new(
            NativeSampleEncoding::Pcm {
                container_bits: 16,
                valid_bits: 16,
            },
            1,
        )
        .expect("valid decoder");
        let bytes = [0x00, 0x80, 0x00, 0x00, 0xff, 0x7f];
        let samples = decoder.decode_interleaved(&bytes).expect("valid PCM16");

        assert_eq!(samples[0], -1.0);
        assert_eq!(samples[1], 0.0);
        assert!((samples[2] - (32767.0 / 32768.0)).abs() < f32::EPSILON);
    }

    #[test]
    fn decodes_signed_pcm24() {
        let decoder = SampleDecoder::new(
            NativeSampleEncoding::Pcm {
                container_bits: 24,
                valid_bits: 24,
            },
            1,
        )
        .expect("valid decoder");
        let bytes = [0x00, 0x00, 0x80, 0xff, 0xff, 0x7f];
        let samples = decoder.decode_interleaved(&bytes).expect("valid PCM24");

        assert_eq!(samples[0], -1.0);
        assert!(samples[1] > 0.999_999);
        assert!(samples[1] < 1.0);
    }

    #[test]
    fn honors_left_aligned_valid_bits_in_larger_pcm_container() {
        let decoder = SampleDecoder::new(
            NativeSampleEncoding::Pcm {
                container_bits: 32,
                valid_bits: 24,
            },
            1,
        )
        .expect("valid decoder");
        let positive_half_left_aligned = (0x0040_0000i32 << 8).to_le_bytes();
        let samples = decoder
            .decode_interleaved(&positive_half_left_aligned)
            .expect("valid left-aligned PCM");

        assert_eq!(samples, vec![0.5]);
    }

    #[test]
    fn decodes_interleaved_float32_stereo() {
        let decoder = SampleDecoder::new(NativeSampleEncoding::Float32, 2).expect("valid decoder");
        let mut bytes = Vec::new();
        for value in [0.25f32, -0.5, 1.0, 0.0] {
            bytes.extend_from_slice(&value.to_le_bytes());
        }
        let samples = decoder
            .decode_interleaved(&bytes)
            .expect("valid float audio");

        assert_eq!(samples, vec![0.25, -0.5, 1.0, 0.0]);
        assert_eq!(decoder.frame_bytes(), 8);
    }

    #[test]
    fn rejects_non_finite_float_and_misaligned_frames() {
        let decoder = SampleDecoder::new(NativeSampleEncoding::Float32, 2).expect("valid decoder");
        let nan = f32::NAN.to_le_bytes();
        let mut bytes = Vec::new();
        bytes.extend_from_slice(&nan);
        bytes.extend_from_slice(&0.0f32.to_le_bytes());
        assert!(matches!(
            decoder.decode_interleaved(&bytes),
            Err(SampleDecodeError::NonFiniteFloat { sample_index: 0 })
        ));
        assert!(matches!(
            decoder.decode_interleaved(&[0; 4]),
            Err(SampleDecodeError::MisalignedInput {
                frame_bytes: 8,
                actual_bytes: 4
            })
        ));
    }

    #[test]
    fn rejects_unsupported_or_invalid_pcm_layouts() {
        assert!(matches!(
            SampleDecoder::new(
                NativeSampleEncoding::Pcm {
                    container_bits: 20,
                    valid_bits: 20
                },
                1
            ),
            Err(SampleDecodeError::UnsupportedPcmContainerBits(20))
        ));
        assert!(matches!(
            SampleDecoder::new(
                NativeSampleEncoding::Pcm {
                    container_bits: 16,
                    valid_bits: 24
                },
                1
            ),
            Err(SampleDecodeError::InvalidValidBits { .. })
        ));
    }
}
