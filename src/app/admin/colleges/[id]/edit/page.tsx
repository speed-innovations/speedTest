import { prisma } from '@/lib/db'
import { notFound } from 'next/navigation'
import CollegeForm from '@/components/admin/CollegeForm'

export default async function EditCollegePage(ctx: { params: Promise<{ id: string }> }) {
  const params = await ctx.params
  const college = await prisma.college.findUnique({ where: { id: params.id } })
  if (!college) return notFound()
  return <CollegeForm college={college} />
}
