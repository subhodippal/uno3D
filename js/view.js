// Logical screen size. When the player forces portrait/landscape and the phone can't lock
// its rotation (iPhone), the whole page is turned 90° with CSS. Code that needs screen
// sizes or pointer positions goes through here so the rotation stays invisible to it.
export const view = {
  rot: false,
  get w() { return this.rot ? window.innerHeight : window.innerWidth; },
  get h() { return this.rot ? window.innerWidth : window.innerHeight; },
  // client (screen) coordinates -> coordinates in the rotated page
  pt(e) { return this.rot ? { x: e.clientY, y: window.innerWidth - e.clientX } : { x: e.clientX, y: e.clientY }; },
};
