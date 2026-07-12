import { useEffect, useRef, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaView, StyleSheet, Text, View, Pressable } from 'react-native';
import { EngineWebView } from './src/engine/EngineWebView';
import { useSession } from './src/ui/useSession';
import { pipCounts } from './src/game/rules';
import { Board } from './src/ui/Board';

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

  const canSwap =
    state.phase === 'moving' && b && b.dice[0] !== b.dice[1] && state.pendingHops.length === 0;

  return (
    <SafeAreaView style={styles.root}>
      <StatusBar style="light" />
      <EngineWebView />

      <View style={styles.header}>
        <Text style={styles.title}>Backgammon</Text>
        <Text style={styles.status}>
          {!state.engineReady ? 'Loading engine…' : pips ? `You ${pips.mine} · gnubg ${pips.theirs}` : ''}
        </Text>
      </View>

      <View style={styles.boardWrap}>
        {b ? (
          <Board board={b} pendingHops={state.pendingHops} sources={sources} onPointClick={onPointClick} />
        ) : (
          <Text style={styles.dim}>Dealing…</Text>
        )}
      </View>

      <View style={styles.controls}>
        {state.phase === 'awaitRoll' && (
          <Btn label="Roll" primary onPress={() => void session.roll()} disabled={state.thinking} />
        )}
        {state.phase === 'moving' && (
          <>
            {canSwap && <Btn label={`Use ${firstDie === 0 ? b!.dice[1] : b!.dice[0]} first`} onPress={() => setFirstDie((f) => (f === 0 ? 1 : 0))} />}
            <Btn label="Undo" onPress={() => session.undoHops()} disabled={state.pendingHops.length === 0} />
            <Btn label="Confirm" primary onPress={() => void session.commitMove()} disabled={!state.canCommit} />
          </>
        )}
        {state.phase === 'matchOver' && (
          <Btn label="New match" primary onPress={() => void session.newMatch('m' + Date.now().toString(36), 7, 2)} />
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
  root: { flex: 1, backgroundColor: '#14110d', paddingHorizontal: 10 },
  header: { alignItems: 'center', marginTop: 6 },
  title: { color: '#efe6d0', fontSize: 20, fontWeight: '700' },
  status: { color: '#c8b993', fontSize: 13, marginTop: 2 },
  boardWrap: { flex: 1, alignSelf: 'stretch', marginVertical: 8, justifyContent: 'center' },
  dim: { color: '#6b6250', textAlign: 'center' },
  controls: { flexDirection: 'row', justifyContent: 'center', gap: 10, marginBottom: 12, minHeight: 48 },
  btn: { paddingHorizontal: 20, paddingVertical: 12, borderRadius: 10 },
  btnPrimary: { backgroundColor: '#c8a24a' },
  btnGhost: { backgroundColor: '#2b2620', borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)' },
  btnDisabled: { opacity: 0.4 },
  btnText: { fontWeight: '700', fontSize: 15 },
  btnTextPrimary: { color: '#20242b' },
  btnTextGhost: { color: '#e7dcc1' },
});
