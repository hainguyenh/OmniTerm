use super::*;

fn restored(chunks: &[&[u8]]) -> String {
    let mut modes = TerminalModes::default();
    for chunk in chunks {
        modes.observe(chunk);
    }
    String::from_utf8(modes.restore_sequence()).expect("ascii")
}

#[test]
fn restores_the_mouse_modes_a_tui_switched_on() {
    // Claude Code's full-screen mode: every mouse mode at once, in one sequence each.
    let claude =
        b"\x1b[?1049h\x1b[?1000h\x1b[?1002h\x1b[?1003h\x1b[?1006h\x1b[?2004h\x1b[?25lhello";
    assert_eq!(
        restored(&[claude]),
        "\x1b[?1000h\x1b[?1002h\x1b[?1003h\x1b[?1006h\x1b[?2004h\x1b[?25l"
    );
}

#[test]
fn forgets_modes_switched_off_again_and_a_full_reset() {
    assert_eq!(restored(&[b"\x1b[?1000;1006h", b"\x1b[?1006;1000l"]), "");
    assert_eq!(restored(&[b"\x1b[?25l", b"\x1b[?25h"]), "");
    assert_eq!(restored(&[b"\x1b[?1000h\x1b[?25l", b"\x1bc"]), "");
}

#[test]
fn follows_a_switch_split_across_chunks() {
    assert_eq!(
        restored(&[b"text\x1b", b"[?10", b"06h more"]),
        "\x1b[?1006h"
    );
    assert_eq!(restored(&[b"\x1b[", b"?2004h"]), "\x1b[?2004h");
}

#[test]
fn ignores_other_modes_and_sequences() {
    // The alternate screen, synchronized output and ordinary CSI / OSC sequences are left alone.
    let other = b"\x1b[?1049h\x1b[?2026h\x1b[2J\x1b[31mred\x1b]0;title\x07\x1b[?2026l\x1b[?99999h";
    assert_eq!(restored(&[other]), "");
}

#[test]
fn drops_an_overlong_unfinished_sequence() {
    let mut modes = TerminalModes::default();
    let mut long = b"\x1b[?".to_vec();
    long.extend(std::iter::repeat_n(b'1', MAX_PENDING * 2));
    modes.observe(&long);
    assert!(modes.pending.is_empty());
    modes.observe(b"h\x1b[?1000h");
    assert_eq!(modes.restore_sequence(), b"\x1b[?1000h");
}
