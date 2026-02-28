import { SidebarNav } from "./sidebar-nav"

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen bg-background">
      <SidebarNav />
      <main className="flex-1 overflow-auto">
        {children}
      </main>
    </div>
  )
}
