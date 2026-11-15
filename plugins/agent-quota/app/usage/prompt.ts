/**
 * Letters, digits, spaces and plain punctuation only. The wake prompt is user text that ends up on
 * a command line (through cmd.exe for npm `.cmd` shims), so anything a shell could interpret is
 * refused rather than escaped. Dependency-free: the settings UI validates with the same rule.
 */
const SAFE_PROMPT = /^[\p{L}\p{N} .,?'-]{1,120}$/u

export function isSafePrompt(prompt: string): boolean {
  return SAFE_PROMPT.test(prompt) && prompt.trim().length > 0
}
