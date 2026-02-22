export default function RootLoading() {
  return (
    <div className="h-dvh flex flex-col items-center justify-center gap-3">
      <svg className="w-10 h-10 animate-spin text-muted-foreground" fill="none" viewBox="0 0 24 24">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
      </svg>
      <span className="text-sm text-muted-foreground">Loading Big Context...</span>
    </div>
  );
}
