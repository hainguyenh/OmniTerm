//! UTC offsets of IANA time zones, for reset times agents print in the account's zone.
//!
//! Windows has no zoneinfo directory, but ships ICU (`icu.dll`, Windows 10 1903 and later), whose
//! calendar knows every IANA zone and the user's own. Elsewhere the system's TZif files are read.
//! An unknown zone is reported as such so the caller can fall back to local time, as the original
//! renderer-side parser did.

/// Offset of `zone` (local time when `None`) from UTC at `epoch_ms`, in milliseconds.
pub(crate) fn offset_ms(epoch_ms: i64, zone: Option<&str>) -> Option<i64> {
    imp::offset_ms(epoch_ms, zone)
}

/// Whether `zone` names a time zone this machine can resolve.
pub(crate) fn is_known(zone: &str) -> bool {
    !zone.is_empty() && zone.len() <= 64 && imp::is_known(zone)
}

#[cfg(windows)]
mod imp {
    use windows::core::PCSTR;
    use windows::Win32::Globalization::{
        ucal_close, ucal_get, ucal_getCanonicalTimeZoneID, ucal_open, ucal_setMillis, UErrorCode,
        UCAL_DST_OFFSET, UCAL_GREGORIAN, UCAL_ZONE_OFFSET, U_ZERO_ERROR,
    };

    fn failed(status: UErrorCode) -> bool {
        status.0 > 0
    }

    fn utf16(text: &str) -> Vec<u16> {
        text.encode_utf16().collect()
    }

    pub(super) fn is_known(zone: &str) -> bool {
        let id = utf16(zone);
        let Ok(len) = i32::try_from(id.len()) else {
            return false;
        };
        let mut canonical = [0u16; 128];
        let mut system = 0i8;
        let mut status = U_ZERO_ERROR;
        // SAFETY: every pointer refers to a live local buffer whose length is passed alongside it.
        let written = unsafe {
            ucal_getCanonicalTimeZoneID(
                id.as_ptr(),
                len,
                canonical.as_mut_ptr(),
                128,
                &mut system,
                &mut status,
            )
        };
        !failed(status) && written > 0
    }

    pub(super) fn offset_ms(epoch_ms: i64, zone: Option<&str>) -> Option<i64> {
        if zone.is_some_and(|name| !is_known(name)) {
            return None;
        }
        let id = zone.map(utf16).unwrap_or_default();
        let len = i32::try_from(id.len()).ok()?;
        let pointer = if id.is_empty() {
            std::ptr::null()
        } else {
            id.as_ptr()
        };
        let mut status = U_ZERO_ERROR;
        // SAFETY: a null zone id with length 0 asks ICU for the default (user) zone; otherwise the
        // id buffer outlives the call. The calendar is closed below on every path.
        let calendar =
            unsafe { ucal_open(pointer, len, PCSTR::null(), UCAL_GREGORIAN, &mut status) };
        if calendar.is_null() || failed(status) {
            return None;
        }
        // SAFETY: `calendar` is the live handle opened above.
        let offset = unsafe {
            ucal_setMillis(calendar, epoch_ms as f64, &mut status);
            let raw = ucal_get(
                calendar as *const *const core::ffi::c_void,
                UCAL_ZONE_OFFSET,
                &mut status,
            );
            let dst = ucal_get(
                calendar as *const *const core::ffi::c_void,
                UCAL_DST_OFFSET,
                &mut status,
            );
            ucal_close(calendar);
            i64::from(raw) + i64::from(dst)
        };
        (!failed(status)).then_some(offset)
    }
}

#[cfg(not(windows))]
mod imp {
    use super::super::zone_tzif::{self, Tzif};

    fn load(zone: Option<&str>) -> Option<Tzif> {
        match zone {
            Some(name) => zone_tzif::load_named(name),
            None => Some(zone_tzif::load_local()),
        }
    }

    pub(super) fn is_known(zone: &str) -> bool {
        load(Some(zone)).is_some()
    }

    pub(super) fn offset_ms(epoch_ms: i64, zone: Option<&str>) -> Option<i64> {
        load(zone).map(|tz| tz.offset_seconds(epoch_ms.div_euclid(1000)) * 1000)
    }
}

#[cfg(test)]
#[path = "zone_tests.rs"]
mod tests;
