import {
  Bell,
  Brain,
  CheckSquare,
  Download,
  Eraser,
  Globe,
  Hammer,
  ListTodo,
  MessageCircleQuestion,
  Pencil,
  Search,
  Server,
  Sparkles,
  Wrench,
  type LucideIcon,
} from 'lucide-react'

import type { ActivityOrigin } from '../../shared/protocol'

/**
 * What a tool call should *say* it is doing.
 *
 * A card headed `bloom__build_agent` with a JSON blob under it is the wall of text
 * this whole change exists to remove — it is the raw name of an implementation
 * detail, and reading it requires already knowing the system. The label is the
 * sentence a person would use.
 *
 * Unknown tools are not a failure case. New ones arrive whenever a peer registers,
 * so `describe` always returns something usable and the fallback is designed to be
 * read, not to look broken: `bloom__list_agents` becomes "list agents", via Bloom.
 */
export interface ToolMeta {
  icon: LucideIcon
  /** Present tense, for a call in flight: "Searching the web". */
  active: string
  /** Past tense, for a finished one: "Searched the web". */
  done: string
  /** The argument worth putting on the collapsed row, when there is one. */
  summary?: (input: Record<string, unknown>) => string | undefined
}

const str = (v: unknown): string | undefined =>
  typeof v === 'string' && v.trim() ? v.trim() : undefined

const KNOWN: Record<string, ToolMeta> = {
  // --- Amber's own ---
  web_search: {
    icon: Search,
    active: 'Searching the web',
    done: 'Searched the web',
    summary: (i) => str(i.query),
  },
  read_url: {
    icon: Globe,
    active: 'Reading a page',
    done: 'Read a page',
    // The host is the useful part; a full URL is mostly noise on one line.
    summary: (i) => {
      const url = str(i.url)
      if (!url) return undefined
      try {
        return new URL(url).host
      } catch {
        return url
      }
    },
  },
  search_memory: {
    icon: Brain,
    active: 'Searching her memory',
    done: 'Searched her memory',
    summary: (i) => str(i.query),
  },
  remember_fact: {
    icon: Brain,
    active: 'Remembering something',
    done: 'Remembered something',
    summary: (i) => str(i.content),
  },
  correct_fact: {
    icon: Pencil,
    active: 'Correcting a memory',
    done: 'Corrected a memory',
    summary: (i) => str(i.content),
  },
  forget_fact: {
    icon: Eraser,
    active: 'Forgetting something',
    done: 'Forgot something',
  },
  recall_recent: {
    icon: Brain,
    active: 'Recalling the conversation',
    done: 'Recalled the conversation',
  },
  add_task: {
    icon: ListTodo,
    active: 'Adding a task',
    done: 'Added a task',
    summary: (i) => str(i.title) ?? str(i.task),
  },
  list_tasks: { icon: ListTodo, active: 'Checking tasks', done: 'Checked tasks' },
  complete_task: {
    icon: CheckSquare,
    active: 'Completing a task',
    done: 'Completed a task',
  },
  set_reminder: {
    icon: Bell,
    active: 'Setting a reminder',
    done: 'Set a reminder',
    summary: (i) => str(i.text) ?? str(i.title),
  },
  list_reminders: { icon: Bell, active: 'Checking reminders', done: 'Checked reminders' },
  complete_reminder: {
    icon: CheckSquare,
    active: 'Completing a reminder',
    done: 'Completed a reminder',
  },
  update_server: { icon: Download, active: 'Updating herself', done: 'Updated herself' },
  expect_reply: {
    icon: MessageCircleQuestion,
    active: 'Waiting for your answer',
    done: 'Asked you something',
  },

  // --- Bloom, reached as a peer ---
  bloom__build_agent: {
    icon: Sparkles,
    active: 'Building an agent',
    done: 'Built an agent',
    summary: (i) => str(i.brief),
  },
  bloom__run_task: {
    icon: Hammer,
    active: 'Handing work to an agent',
    done: 'Handed work to an agent',
    summary: (i) => str(i.description),
  },
  bloom__list_agents: {
    icon: Server,
    active: 'Checking which agents exist',
    done: 'Checked which agents exist',
  },
}

/** A tool's presentation, always — invented from the name when it isn't known. */
export function describe(name: string, origin: ActivityOrigin): ToolMeta {
  const known = KNOWN[name]
  if (known) return known

  // Fall back to something readable rather than something honest-but-hostile.
  // `bloom__list_agents` -> "list agents"; `client_show_text` -> "show text".
  const bare = name.includes('__')
    ? name.slice(name.indexOf('__') + 2)
    : name.startsWith('client_')
      ? name.slice('client_'.length)
      : name
  const phrase = bare.replace(/_/g, ' ')
  return {
    icon: origin.startsWith('peer:') ? Server : Wrench,
    active: phrase,
    done: phrase,
  }
}

/** How an origin should be labelled on a badge. `peer:bloom` -> `bloom`. */
export function originLabel(origin: ActivityOrigin): string {
  if (origin.startsWith('peer:')) return origin.slice('peer:'.length)
  if (origin === 'client') return 'this device'
  return origin === 'signal' ? 'signal' : 'amber'
}

/** True when this call is a Bloom build, which gets its own live run view. */
export function isBloomBuild(name: string): boolean {
  return name === 'bloom__build_agent'
}
