/**
 * Every settings page there is.
 *
 * This file is the extension point: a new page is an object in this array plus a
 * component that calls `useSettings()`. The shell draws the rail, the title, the
 * blurb, the breadcrumb, the filter and the save bar from what is declared here, so
 * there is nothing else to register and nothing to keep in sync.
 *
 * Ordering rules worth keeping:
 *
 * - Sections group by *what you are configuring*, not by which module implements it.
 *   Amber's voice and Amber's brain belong together even though one is a TTS request
 *   and the other is a model keyword; the terminal's typing prediction belongs with
 *   Servers even though it is drawn by the renderer.
 * - A page is a page when it has its own explanation. If a control needs a paragraph
 *   before you can safely touch it, it is not a row on somebody else's page.
 * - A child page is for state with a *different commit rule* or a different owner.
 *   Keywords hangs off Brain because it is shared with the whole ecosystem and saves
 *   itself, which the save bar cannot express.
 * - `keywords` should carry the words you would actually type when hunting: the env
 *   var, the protocol, the unit. Labels are for reading, keywords are for finding.
 */

import { Appearance } from './pages/Appearance'
import { Bloom } from './pages/Bloom'
import { Brain } from './pages/Brain'
import { Connection } from './pages/Connection'
import { Extensions } from './pages/Extensions'
import { TouchDesigner } from './pages/TouchDesigner'
import { Keywords } from './pages/Keywords'
import { Operations } from './pages/Operations'
import { Terminal } from './pages/Terminal'
import { Voice } from './pages/Voice'
import type { SettingsSection } from './tree'

export const SETTINGS: SettingsSection[] = [
  {
    id: 'aperture',
    label: 'Aperture',
    pages: [
      {
        id: 'appearance',
        label: 'Appearance',
        blurb: 'How the app looks. Colour, shape, type and texture travel together.',
        keywords: ['theme', 'colour', 'color', 'dark', 'light', 'font', 'texture'],
        Content: Appearance,
      },
    ],
  },
  {
    id: 'amber',
    label: 'Amber',
    pages: [
      {
        id: 'connection',
        label: 'Connection',
        blurb: 'Where Amber is, and how this app proves it may talk to her.',
        keywords: ['url', 'websocket', 'ws', 'wss', 'token', 'bearer', 'auth', 'session'],
        Content: Connection,
      },
      {
        id: 'voice',
        label: 'Voice',
        blurb: 'How Amber sounds, and whether this machine plays her at all.',
        keywords: ['tts', 'speech', 'speed', 'rate', 'audio', 'mute', 'instructions'],
        Content: Voice,
      },
      {
        id: 'brain',
        label: 'Brain',
        blurb: 'Which model answers on this connection.',
        keywords: ['model', 'llm', 'tier', 'openrouter'],
        Content: Brain,
        children: [
          {
            id: 'keywords',
            label: 'Keywords',
            blurb:
              'What each word points at — shared with every app through the sync store.',
            keywords: ['map', 'coding', 'sync store', 'openrouter', 'remap', 'ecosystem'],
            Content: Keywords,
          },
        ],
      },
    ],
  },
  {
    id: 'device',
    label: 'This device',
    pages: [
      {
        id: 'extensions',
        label: 'Extensions',
        blurb:
          'What Amber may do on this machine, and what each permission actually means.',
        keywords: [
          'permission',
          'grant',
          'power',
          'shutdown',
          'sleep',
          'capability',
          'device',
          'consent',
        ],
        Content: Extensions,
      },
      {
        id: 'touchdesigner',
        label: 'TouchDesigner',
        blurb: 'Which projects this machine can open, and the port their Web Server DAT listens on.',
        keywords: [
          'td',
          'toe',
          'web server dat',
          'port',
          'scene',
          'preset',
          'visuals',
          'projector',
          'localhost',
          '9980',
        ],
        Content: TouchDesigner,
      },
    ],
  },
  {
    id: 'servers',
    label: 'Servers',
    pages: [
      {
        id: 'terminal',
        label: 'Terminal',
        blurb: 'Typing, prediction and completion in the SSH shells.',
        keywords: ['ssh', 'echo', 'latency', 'suggestions', 'completion', 'tab'],
        Content: Terminal,
      },
      {
        id: 'operations',
        label: 'Operations',
        blurb: 'How much the Servers tab offers, and how much it narrates.',
        keywords: ['advanced', 'verbose', 'logs', 'approval', 'confirm', 'audit'],
        Content: Operations,
      },
    ],
  },
  {
    id: 'apps',
    label: 'Apps',
    pages: [
      {
        id: 'bloom',
        label: 'Bloom',
        blurb: 'The manual link, for a Bloom no configured server reaches.',
        keywords: ['link', 'admin key', 'keychain', 'agents'],
        Content: Bloom,
      },
    ],
  },
]
