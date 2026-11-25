/**
 * Escapes free text so it can be placed inside a `/** ... *\/` block comment.
 *
 * A `*\/` sequence in the text would end the comment early and turn the rest of
 * the line into code in the generated file. Writing it as `*\/` keeps it inside
 * the comment and still reads the same in editor tooltips.
 */
export function escapeJsDocText(value: string): string {
  return value.replaceAll("*/", String.raw`*\/`);
}
