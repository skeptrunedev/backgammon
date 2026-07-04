export interface BoardState {
  playerName: string;
  opponentName: string;
  matchLength: number;
  myScore: number;
  oppScore: number;
  points: number[];
  turn: number;
  dice: [number, number];
  cubeValue: number;
  iMayDouble: boolean;
  oppMayDouble: boolean;
  wasDoubled: boolean;
  myOff: number;
  oppOff: number;
  crawford: boolean;
}

export interface HintMove {
  rank: number;
  evalDesc: string;
  move: string;
  equity: number;
  diff: number;
  probs: number[] | null;
}

export interface CubeHint {
  cubelessEquity: number | null;
  probs: number[] | null;
  options: { label: string; equity: number; diff: number }[];
  proper: string;
}

export type EngineEvent =
  | { type: 'ready' }
  | { type: 'board'; state: BoardState }
  | { type: 'line'; text: string }
  | { type: 'resignOffer'; value: number }
  | { type: 'gameOver'; text: string }
  | { type: 'matchOver'; text: string }
  | { type: 'crashed'; error: string };

export interface EngineRequest {
  id: number;
  cmd:
    | { type: 'command'; text: string }
    | { type: 'nextTurn' }
    | { type: 'readFile'; path: string };
}

export interface EngineResponse {
  id: number;
  ok: boolean;
  lines?: string[];
  file?: string;
  error?: string;
}

export type CheckerHop = { from: number; to: number };

export const BAR = 25;
export const OFF = 0;
