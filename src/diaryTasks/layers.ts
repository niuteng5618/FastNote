// 弹窗层级栈：日记与待办面板之上还会叠加「编辑弹窗」，
// 按 Esc 时只能关掉最上面那层，否则会连下层面板一起关掉。

export type LayerToken = symbol

const stack: LayerToken[] = []

export function pushLayer(): LayerToken {
  const token: LayerToken = Symbol('dt-layer')
  stack.push(token)
  return token
}

export function popLayer(token: LayerToken): void {
  const i = stack.indexOf(token)
  if (i >= 0) stack.splice(i, 1)
}

export function isTopLayer(token: LayerToken): boolean {
  return stack.length > 0 && stack[stack.length - 1] === token
}
