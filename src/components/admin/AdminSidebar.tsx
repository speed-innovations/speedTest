'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { signOut } from 'next-auth/react'
import SpeedLogo from '@/components/ui/SpeedLogo'
import clsx from 'clsx'
import {
  LayoutDashboard, Building2, ClipboardList, BookOpen,
  Users, UserCheck, Briefcase, FileText, Settings, LogOut,
  ChevronRight, Filter, Upload
} from 'lucide-react'

const navItems = [
  { href: '/admin', label: 'Dashboard', icon: LayoutDashboard, exact: true },
  { href: '/admin/colleges', label: 'Colleges', icon: Building2 },
  { href: '/admin/tests', label: 'Tests & Schedules', icon: ClipboardList },
  { href: '/admin/question-bank', label: 'Question Bank', icon: BookOpen },
  { href: '/admin/coordinators', label: 'Coordinators', icon: Users },
  { href: '/admin/candidates', label: 'Candidates', icon: UserCheck },
  { href: '/admin/job-openings', label: 'Job Openings', icon: Briefcase },
  { href: '/admin/results', label: 'Results & Reports', icon: FileText },
  { href: '/admin/shortlist', label: 'Shortlist Criteria', icon: Filter },
  { href: '/admin/settings', label: 'Settings', icon: Settings },
]

export default function AdminSidebar({ user }: { user: any }) {
  const pathname = usePathname()

  return (
    <aside className="w-64 flex-shrink-0 flex flex-col h-full"
      style={{ background: 'linear-gradient(180deg, #3B1F8C 0%, #2A1566 100%)' }}>
      {/* Logo */}
      <div className="p-5 border-b border-white/10">
        <SpeedLogo size="sm" light />
      </div>

      {/* Role badge */}
      <div className="px-4 py-3">
        <div className="bg-white/10 rounded-lg px-3 py-2">
          <div className="text-xs text-white/50 uppercase tracking-wide">Signed in as</div>
          <div className="text-sm text-white font-medium truncate mt-0.5">{user?.name}</div>
          <div className="text-xs text-brand-teal mt-0.5">App Administrator</div>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-2 space-y-0.5 overflow-y-auto">
        {navItems.map(item => {
          const active = item.exact ? pathname === item.href : pathname.startsWith(item.href)
          return (
            <Link key={item.href} href={item.href}
              className={clsx('sidebar-link', active && 'active')}>
              <item.icon size={17} />
              <span className="flex-1">{item.label}</span>
              {active && <ChevronRight size={14} className="text-brand-purple" />}
            </Link>
          )
        })}
      </nav>

      {/* Footer */}
      <div className="p-3 border-t border-white/10">
        <button onClick={() => signOut({ callbackUrl: '/login' })}
          className="sidebar-link w-full text-red-300 hover:bg-red-500/20 hover:text-red-200">
          <LogOut size={17} />
          Sign Out
        </button>
      </div>
    </aside>
  )
}
