import { getPasswordRuleChecks } from "@/lib/passwordPolicy";

export function PasswordRuleHint({ password }: { password: string }) {
  const checks = getPasswordRuleChecks(password);
  const showNeutral = password.length === 0;

  return (
    <div className="rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-xs">
      <p className="font-medium text-gray-600">密码强度规则</p>
      <div className="mt-2 grid gap-1 sm:grid-cols-2">
        {checks.map((check) => (
          <div
            key={check.label}
            className={showNeutral ? "text-gray-500" : check.passed ? "text-green-700" : "text-red-600"}
          >
            {showNeutral ? "•" : check.passed ? "✓" : "×"} {check.label}
          </div>
        ))}
      </div>
    </div>
  );
}
