// The desk's control surface: what any controller outside the page (a script, a remote, an AI conductor) can
// read and send. Commands go through the same steer/edit path as the UI, so the music never jumps.
import type { Routing } from '../../runtime/routing';
import type { Decision } from '../../runtime/player';
import type { FormScope, Phase } from './form';
import type { Targets } from './model';

export type Snapshot = {
  playing: boolean;
  paused: boolean;
  volume: number; // 0..1
  cycle: number;
  secondsPerCycle: number;
  key: number;
  chord: { index: number; count: number };
  targets: Targets;
  form: { auto: boolean; phase: Phase; level: number; peak: number; arc: number; lastTurn?: string; scope: FormScope };
  routing: Routing;
  recent: Decision[];
};

/** Canon is partial: the desk merges it with its live canon targets. */
export type SteerPatch = Omit<Partial<Targets>, 'canon'> & { canon?: Partial<Targets['canon']> };

export type Command =
  | { type: 'steer'; patch: SteerPatch }
  | { type: 'form'; auto?: boolean; scope?: FormScope; force?: 'build' | 'release' | 'turn' }
  | { type: 'instruments'; routing: Routing }
  | { type: 'transport'; action: 'play' | 'pause' | 'stop' }
  | { type: 'volume'; value: number }; // 0..1

export type Desk = {
  /** Apply a command; resolves once it took effect (instruments loaded, audio started), rejects with a reason. */
  apply(command: Command): Promise<void>;
  snapshot(): Snapshot;
  /** Called after every render: a cycle, a UI change or a command. */
  onRender(listener: () => void): void;
  /** The page header, for a controller to add its own status. */
  header: HTMLElement;
};
