import { useEffect, useMemo, useRef, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaView, StyleSheet, Text, View, Pressable, useWindowDimensions } from 'react-native';
import { EngineWebView } from './src/engine/EngineWebView';
import { useSession } from './src/ui/useSession';
import { pipCounts } from './src/game/rules';
import { Board, boardMetrics } from './src/ui/Board';

export default function App() {
  const { session, state } = useSession();
  const [firstDie, setFirstDie] = useState(0);
  const startedRef = useRef(false);

  // Start a match once the engine is ready.
  useEffect(() => {
    if (state.engineReady && !startedRef.current && state.phase === 'idle') {
      startedRef.current = true;
      void session.newMatch('m' + Date.now().toString(36), 7, 2);
    }
  }, [state.engineReady, state.phase, session]);

  const b = state.board;
  const conts = state.phase === 'moving' ? session.continuationsNow() : [];
  const sources = [...new Set(conts.map((h) => h.from))];
  const pips = b ? pipCounts(b.points) : null;

  const hopDist = (h: { from: number; to: number }) => h.from - (h.to === 0 ? 0 : h.to);
  const onPointClick = (p: number) => {
    if (state.phase !== 'moving' || !b) return;
    const fromP = conts.filter((h) => h.from === p);
    if (fromP.length === 0) return;
    const order = firstDie === 0 ? [b.dice[0], b.dice[1]] : [b.dice[1], b.dice[0]];
    for (const d of order) {
      const hop = fromP.find((h) => hopDist(h) === d);
      if (hop) return session.addHop(hop);
    }
    session.addHop(fromP[0]);
  };

  // Reset the preferred die whenever a fresh roll arrives.
  const rollKey = `${b?.dice[0]}-${b?.dice[1]}-${state.phase}`;
  useEffect(() => {
    setFirstDie(0);
  }, [rollKey]);

  // Landscape phones (16:9 and wider) get the web app's wide board so it fills the
  // screen width; tablets keep the classic board.
  const win = useWindowDimensions();
  const wide = win.width / win.height >= 1.6;
  // Contain the board in the arena, preserving its aspect. In wide mode the
  // board is proportioned to the arena itself, so it fills the full width.
  const [arena, setArena] = useState<{ w: number; h: number } | null>(null);
  const aspect = arena && arena.h > 0 ? arena.w / arena.h : 2;
  const metrics = useMemo(() => boardMetrics(wide, aspect), [wide, aspect]);
  const box = useMemo(() => {
    if (!arena || arena.w <= 0 || arena.h <= 0) return null;
    const scale = Math.min(arena.w / metrics.w, arena.h / metrics.h);
    const w = metrics.w * scale;
    const h = metrics.h * scale;
    return { w, h, left: (arena.w - w) / 2, top: (arena.h - h) / 2 };
  }, [arena, metrics]);

  const status = !state.engineReady ? 'Loading engine…' : pips ? `You ${pips.mine} · gnubg ${pips.theirs}` : '';

  return (
    <SafeAreaView style={styles.root}>
      <StatusBar hidden />
      <EngineWebView />

      <View style={styles.arena} onLayout={(e) => setArena({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}>
        {box && b ? (
          <View style={{ position: 'absolute', left: box.left, top: box.top, width: box.w, height: box.h }}>
            <Board
              board={b}
              wide={wide}
              aspect={aspect}
              pendingHops={state.pendingHops}
              sources={sources}
              onPointClick={onPointClick}
              activeDie={firstDie}
              onDieClick={state.phase === 'moving' ? () => setFirstDie((f) => (f === 0 ? 1 : 0)) : undefined}
            />

            {/* Overlays in board space: pip counts under the opponent's dice,
                actions under the player's dice (mirrors the web board). */}
            <View pointerEvents="none" style={[styles.anchor, { left: `${(1 - metrics.diceCenterX) * 100}%`, top: `${metrics.belowDiceY * 100}%` }]}>
              {status !== '' && (
                <View style={styles.chip}>
                  <Text style={styles.status}>{status}</Text>
                </View>
              )}
            </View>
            <View pointerEvents="box-none" style={[styles.anchor, { left: `${metrics.diceCenterX * 100}%`, top: `${metrics.belowDiceY * 100}%` }]}>
              <View style={styles.controls}>
                {state.phase === 'awaitRoll' && (
                  <>
                    {state.canDouble && (
                      <Btn label="Double" onPress={() => void session.double()} disabled={state.thinking} />
                    )}
                    <Btn label="Roll" primary onPress={() => void session.roll()} disabled={state.thinking} />
                  </>
                )}
                {state.phase === 'doubleOffered' && (
                  <>
                    <Btn label="Pass double" onPress={() => void session.pass()} disabled={state.thinking} />
                    <Btn label="Take double" primary onPress={() => void session.take()} disabled={state.thinking} />
                  </>
                )}
                {state.phase === 'resignOffered' && (
                  <>
                    <Btn label="Reject resignation" onPress={() => void session.declineResign()} disabled={state.thinking} />
                    <Btn label="Accept resignation" primary onPress={() => void session.acceptResign()} disabled={state.thinking} />
                  </>
                )}
                {state.phase === 'moving' && (
                  <>
                    <Btn label="Undo" onPress={() => session.undoHops()} disabled={state.pendingHops.length === 0} />
                    <Btn label="Confirm" primary onPress={() => void session.commitMove()} disabled={!state.canCommit} />
                  </>
                )}
              </View>
            </View>

            {state.phase === 'matchOver' && (
              <View style={styles.center}>
                <Btn label="New match" primary onPress={() => void session.newMatch('m' + Date.now().toString(36), 7, 2)} />
              </View>
            )}
          </View>
        ) : (
          <View style={styles.center}>
            <Text style={styles.dim}>{state.engineReady ? 'Dealing…' : 'Loading engine…'}</Text>
          </View>
        )}
      </View>
    </SafeAreaView>
  );
}

function Btn({ label, onPress, primary, disabled }: { label: string; onPress: () => void; primary?: boolean; disabled?: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={[styles.btn, primary ? styles.btnPrimary : styles.btnGhost, disabled && styles.btnDisabled]}
    >
      <Text style={[styles.btnText, primary ? styles.btnTextPrimary : styles.btnTextGhost]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#14110d' },
  arena: { flex: 1, margin: 6 },
  anchor: { position: 'absolute', width: 480, marginLeft: -240, alignItems: 'center' },
  chip: { backgroundColor: 'rgba(20,17,13,0.7)', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5 },
  status: { color: '#c8b993', fontSize: 13, fontWeight: '600' },
  center: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, alignItems: 'center', justifyContent: 'center' },
  dim: { color: '#6b6250', textAlign: 'center' },
  controls: {
    flexDirection: 'row',
    gap: 6,
    padding: 4,
    borderRadius: 10,
    backgroundColor: 'rgba(20,17,13,0.7)',
  },
  btn: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8 },
  btnPrimary: { backgroundColor: '#c8a24a' },
  btnGhost: { backgroundColor: '#2b2620', borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)' },
  btnDisabled: { opacity: 0.4 },
  btnText: { fontWeight: '700', fontSize: 14 },
  btnTextPrimary: { color: '#20242b' },
  btnTextGhost: { color: '#e7dcc1' },
});
