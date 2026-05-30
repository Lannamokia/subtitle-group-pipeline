export const PASSWORD_RULES = [
  "8-128 个字符",
  "至少包含 1 个英文字母",
  "至少包含 1 个数字",
  "不能包含空格或换行",
] as const;

export const PASSWORD_RULE_MESSAGE = `密码需满足：${PASSWORD_RULES.join("、")}`;

export type PasswordRuleCheck = {
  label: string;
  passed: boolean;
};

export function getPasswordRuleChecks(password: string): PasswordRuleCheck[] {
  return [
    { label: PASSWORD_RULES[0], passed: password.length >= 8 && password.length <= 128 },
    { label: PASSWORD_RULES[1], passed: /[A-Za-z]/.test(password) },
    { label: PASSWORD_RULES[2], passed: /\d/.test(password) },
    { label: PASSWORD_RULES[3], passed: password.length > 0 && !/\s/.test(password) },
  ];
}

export function validatePassword(password: string): { valid: boolean; issues: string[] } {
  const issues = getPasswordRuleChecks(password)
    .filter((item) => !item.passed)
    .map((item) => item.label);

  return {
    valid: issues.length === 0,
    issues,
  };
}
