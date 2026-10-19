export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    // Allow sentence case: Dependabot writes "Bump x from 1 to 2".
    'subject-case': [2, 'never', ['start-case', 'pascal-case', 'upper-case']],
  },
};
