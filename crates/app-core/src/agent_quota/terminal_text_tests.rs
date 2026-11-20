use super::*;

fn stripped(raw: &str) -> String {
    string(&strip_terminal(raw))
}

fn string(text: &[char]) -> String {
    text.iter().collect()
}

#[test]
fn removes_osc_sequences_ended_by_bel_or_string_terminator() {
    assert_eq!(stripped("a\u{1b}]0;title\u{7}b"), "ab");
    assert_eq!(stripped("a\u{1b}]8;;https://x\u{1b}\\link"), "alink");
}

#[test]
fn keeps_an_unterminated_osc_for_the_later_passes() {
    // No terminator at all: the OSC pass leaves it, the escape pass then drops `ESC ]`.
    assert_eq!(string(&strip_osc(&chars("\u{1b}]0;t"))), "\u{1b}]0;t");
    assert_eq!(stripped("\u{1b}]0;t"), "0;t");
    // An ESC that is not the start of `ESC \` does not end the OSC either.
    assert_eq!(
        string(&strip_osc(&chars("\u{1b}]0;t\u{1b}X"))),
        "\u{1b}]0;t\u{1b}X"
    );
    assert_eq!(stripped("\u{1b}]0;t\u{1b}X"), "0;t");
}

#[test]
fn removes_csi_sequences_with_private_parameters_and_intermediates() {
    assert_eq!(stripped("\u{1b}[?25lhidden\u{1b}[?25h"), "hidden");
    assert_eq!(stripped("\u{1b}[2 qcursor"), "cursor");
    assert_eq!(stripped("\u{1b}[1;31mred\u{1b}[0m"), "red");
}

#[test]
fn leaves_incomplete_csi_sequences_in_place() {
    // Cut off before its final byte, at the end of the text.
    assert_eq!(string(&strip_csi(&chars("x\u{1b}[12"))), "x\u{1b}[12");
    assert_eq!(string(&strip_csi(&chars("x\u{1b}["))), "x\u{1b}[");
    assert_eq!(string(&strip_csi(&chars("x\u{1b}[1 "))), "x\u{1b}[1 ");
    // A byte that is no valid final ends the attempt; the text is kept as is.
    assert_eq!(
        string(&strip_csi(&chars("\u{1b}[1\u{7}z"))),
        "\u{1b}[1\u{7}z"
    );
    // Not a CSI at all.
    assert_eq!(string(&strip_csi(&chars("\u{1b}(B"))), "\u{1b}(B");
}

#[test]
fn removes_two_character_escapes_and_carriage_returns_only() {
    assert_eq!(string(&strip_escapes(&chars("a\u{1b}Mb\r\n"))), "ab\n");
    assert_eq!(string(&strip_escapes(&chars("\u{1b}_x"))), "x");
    // `ESC (` is outside `ESC [@-_]`, and a trailing ESC has nothing to pair with.
    assert_eq!(
        string(&strip_escapes(&chars("\u{1b}(B\u{1b}"))),
        "\u{1b}(B\u{1b}"
    );
    assert_eq!(stripped("plain text"), "plain text");
}
