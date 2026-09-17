'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { signOut } from 'next-auth/react'
import SpeedLogo from '@/components/ui/SpeedLogo'
import clsx from 'clsx'
import { LayoutDashboard, User, ClipboardList, PlayCircle, LogOut, ChevronRight } from 'lucide-react'

const navItems = [
  { href: '/student', label: 'My Dashboard', icon: LayoutDashboard, exact: true },
  { href: '/student/profile', label: 'My Profile', icon: User },
  { href: '/student/tests', label: 'My Tests', icon: ClipboardList },
]

export default function StudentSidebar({ user }: { user: any }) {
  const pathname = usePathname()

  return (
    <aside className="w-64 flex-shrink-0 flex flex-col h-full"
      style={{ background: 'linear-gradient(180deg, #2A1566 0%, #1a0e44 100%)' }}>
      <div className="p-5 border-b border-white/10">
        <SpeedLogo size="sm" light />
      </div>
      <div className="px-4 py-3">
        <div className="bg-white/10 rounded-lg px-3 py-2">
          <div className="text-xs text-white/50 uppercase tracking-wide">Candidate</div>
          <div className="text-sm text-white font-medium truncate mt-0.5">{user?.name}</div>
          <div className="text-xs text-brand-teal mt-0.5">Student Portal</div>
        </div>
      </div>
      <nav className="flex-1 px-3 py-2 space-y-0.5">
        {navItems.map(item => {
          const active = item.exact ? pathname === item.href : pathname.startsWith(item.href)
          return (
            <Link key={item.href} href={item.href} className={clsx('sidebar-link', active && 'active')}>
              <item.icon size={17} />
              <span className="flex-1">{item.label}</span>
              {active && <ChevronRight size={14} />}
            </Link>
          )
        })}
      </nav>
      <div className="p-3 border-t border-white/10">
        <button onClick={() => signOut({ callbackUrl: '/login' })}
          className="sidebar-link w-full text-red-300 hover:bg-red-500/20 hover:text-red-200">
          <LogOut size={17} /> Sign Out
        </button>
      </div>
    </aside>
  )
}
