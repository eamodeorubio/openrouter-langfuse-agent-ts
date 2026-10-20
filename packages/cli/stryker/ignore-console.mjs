// Stryker ignore plugin: logging statements are diagnostics, not behavior worth mutating.
// A console call whose only effect is output never has a test that should pin it.
const isConsoleCall = (node) =>
  node.type === 'CallExpression' &&
  node.callee.type === 'MemberExpression' &&
  node.callee.object.type === 'Identifier' &&
  node.callee.object.name === 'console';

export const strykerPlugins = [
  {
    kind: 'Ignore',
    name: 'console',
    value: {
      shouldIgnore(path) {
        if (
          path.isExpressionStatement() &&
          isConsoleCall(path.node.expression)
        ) {
          return 'console statements are not mutated';
        }
        return undefined;
      },
    },
  },
];
