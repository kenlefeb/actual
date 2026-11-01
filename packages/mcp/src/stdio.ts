/** stdout carries the MCP protocol; anything else writing to it would corrupt it. */
export function redirectConsoleToStderr() {
  console.log = console.error;
  console.info = console.error;
  console.debug = console.error;
}
