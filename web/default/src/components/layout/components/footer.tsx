/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
import { cn } from '@/lib/utils'

interface FooterProps {
  logo?: string
  name?: string
  copyright?: string
  className?: string
}

// Blitzball branding: 简洁页脚，仅版权，右下角对齐
export function Footer(props: FooterProps) {
  const currentYear = new Date().getFullYear()

  return (
    <footer
      className={cn('border-border/40 relative z-10 border-t', props.className)}
    >
      <div className='mx-auto max-w-6xl px-6 py-4'>
        <div className='flex flex-col items-end justify-end'>
          <div className='text-muted-foreground/40 text-xs'>
            <span>&copy; {currentYear} Blitzball. All rights reserved.</span>
          </div>
        </div>
      </div>
    </footer>
  )
}
