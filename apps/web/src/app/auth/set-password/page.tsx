import { SetPasswordForm } from "./set-password-form";

export default function SetPasswordPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="space-y-1 text-center">
          <h1 className="text-2xl font-semibold tracking-tight">Set your password</h1>
          <p className="text-sm text-muted-foreground">
            Choose a password to secure your account.
          </p>
        </div>
        <SetPasswordForm />
      </div>
    </div>
  );
}
