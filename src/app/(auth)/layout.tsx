export default function AuthLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-6 px-4 py-10">
      <div className="text-center">
        <h1 className="text-2xl font-semibold">Personal Assistant AI</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Your research and outreach assistant.
        </p>
      </div>
      {children}
    </div>
  );
}
