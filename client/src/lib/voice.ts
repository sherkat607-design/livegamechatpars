import { create } from 'zustand';
import type { VoiceParticipant } from '@shared/types';
import { sounds } from './notify';
import { getSocket } from './socket';

// ---------- UI state for voice ----------

export interface VoiceUi {
  channelId: number | null;
  joining: boolean;
  error: string | null;
  selfMute: boolean;
  selfDeaf: boolean;
  video: boolean;
  screen: boolean;
  /** Speaking flags by user id (including me). */
  speaking: Record<number, boolean>;
  /** Remote media streams by user id. */
  remote: Record<number, MediaStream[]>;
  localCamera: MediaStream | null;
  localScreen: MediaStream | null;
  incoming: { channelId: number; from: number } | null;
  connection: Record<number, RTCPeerConnectionState>;
}

export const useVoice = create<VoiceUi>(() => ({
  channelId: null,
  joining: false,
  error: null,
  selfMute: false,
  selfDeaf: false,
  video: false,
  screen: false,
  speaking: {},
  remote: {},
  localCamera: null,
  localScreen: null,
  incoming: null,
  connection: {},
}));

// ---------- device preferences ----------

const PREF_KEY = 'lgcp.voicePrefs';
export interface VoicePrefs {
  inputId?: string;
  outputId?: string;
  videoId?: string;
  noiseSuppression: boolean;
  echoCancellation: boolean;
  volumes: Record<string, number>;
}

export function getVoicePrefs(): VoicePrefs {
  try {
    const raw = JSON.parse(localStorage.getItem(PREF_KEY) ?? '{}');
    return {
      inputId: raw.inputId,
      outputId: raw.outputId,
      videoId: raw.videoId,
      noiseSuppression: raw.noiseSuppression !== false,
      echoCancellation: raw.echoCancellation !== false,
      volumes: raw.volumes && typeof raw.volumes === 'object' ? raw.volumes : {},
    };
  } catch {
    return { noiseSuppression: true, echoCancellation: true, volumes: {} };
  }
}

export function setVoicePrefs(patch: Partial<VoicePrefs>) {
  const next = { ...getVoicePrefs(), ...patch };
  try {
    localStorage.setItem(PREF_KEY, JSON.stringify(next));
  } catch {
    // ignore
  }
  return next;
}

// ---------- engine ----------

interface Peer {
  userId: number;
  pc: RTCPeerConnection;
  polite: boolean;
  makingOffer: boolean;
  ignoreOffer: boolean;
  senders: { mic?: RTCRtpSender; camera?: RTCRtpSender; screen?: RTCRtpSender; screenAudio?: RTCRtpSender };
  streams: Map<string, MediaStream>;
  audioEls: Map<string, HTMLAudioElement>;
  pendingCandidates: RTCIceCandidateInit[];
}

type SignalData = { description?: RTCSessionDescriptionInit; candidate?: RTCIceCandidateInit | null };

const SPEAK_THRESHOLD = 0.018;

class VoiceEngine {
  private peers = new Map<number, Peer>();
  private mic: MediaStream | null = null;
  private camera: MediaStream | null = null;
  private screen: MediaStream | null = null;
  private iceServers: RTCIceServer[] = [];
  private myId = 0;
  private audioCtx: AudioContext | null = null;
  private meters = new Map<string, { userId: number; analyser: AnalyserNode; source: MediaStreamAudioSourceNode; lastLoud: number }>();
  private meterTimer: number | null = null;
  private serverMute = false;
  private serverDeaf = false;

  get channelId() {
    return useVoice.getState().channelId;
  }

  async join(channelId: number, myId: number): Promise<void> {
    const socket = getSocket();
    if (!socket) throw new Error('offline');
    if (this.channelId === channelId) return;
    if (this.channelId) await this.leave();
    this.myId = myId;
    useVoice.setState({ joining: true, error: null });

    const prefs = getVoicePrefs();
    try {
      this.mic = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: prefs.inputId ? { ideal: prefs.inputId } : undefined,
          echoCancellation: prefs.echoCancellation,
          noiseSuppression: prefs.noiseSuppression,
          autoGainControl: true,
        },
      });
    } catch {
      // No microphone or permission denied: join to listen only.
      this.mic = null;
      useVoice.setState({ error: 'mic_unavailable' });
    }

    const res = (await socket.timeout(10000).emitWithAck('voice:join', { channelId }).catch(() => ({ ok: false, error: 'timeout' }))) as
      | { ok: true; participants: VoiceParticipant[]; iceServers: RTCIceServer[] }
      | { ok: false; error: string };
    if (!res.ok) {
      this.stopLocal();
      useVoice.setState({ joining: false, error: res.error });
      throw new Error(res.error);
    }
    this.iceServers = res.iceServers ?? [];
    this.audioCtx = new AudioContext();
    if (this.mic) this.addMeter(this.myId, this.mic);
    this.startMeters();
    const muted = !this.mic || useVoice.getState().selfMute;
    this.applyMicEnabled(muted);
    useVoice.setState({ channelId, joining: false, selfMute: muted, video: false, screen: false, remote: {}, speaking: {}, connection: {} });
    socket.emit('voice:update', { selfMute: muted, selfDeaf: useVoice.getState().selfDeaf });
    // The newcomer connects to everyone already there.
    for (const p of res.participants) this.ensurePeer(p.userId);
    sounds.join();
  }

  async leave(notifyServer = true) {
    if (notifyServer) getSocket()?.emit('voice:leave');
    for (const peer of this.peers.values()) this.closePeer(peer);
    this.peers.clear();
    this.stopLocal();
    if (this.meterTimer !== null) window.clearInterval(this.meterTimer);
    this.meterTimer = null;
    for (const m of this.meters.values()) m.source.disconnect();
    this.meters.clear();
    await this.audioCtx?.close().catch(() => undefined);
    this.audioCtx = null;
    if (useVoice.getState().channelId) sounds.leave();
    useVoice.setState({ channelId: null, joining: false, video: false, screen: false, remote: {}, speaking: {}, localCamera: null, localScreen: null, connection: {} });
  }

  private stopLocal() {
    for (const s of [this.mic, this.camera, this.screen]) s?.getTracks().forEach((t) => t.stop());
    this.mic = this.camera = this.screen = null;
  }

  /** Called with every voice:state for my channel. */
  onVoiceState(participants: VoiceParticipant[]) {
    const ids = new Set(participants.map((p) => p.userId));
    if (!ids.has(this.myId)) return;
    for (const [userId, peer] of this.peers) {
      if (!ids.has(userId)) {
        this.closePeer(peer);
        this.peers.delete(userId);
        useVoice.setState((s) => {
          const remote = { ...s.remote };
          delete remote[userId];
          return { remote };
        });
      }
    }
    const me = participants.find((p) => p.userId === this.myId);
    if (me) {
      this.serverMute = me.serverMute;
      this.serverDeaf = me.serverDeaf;
      this.applyMicEnabled(useVoice.getState().selfMute);
      this.applyDeaf(useVoice.getState().selfDeaf);
    }
  }

  async onSignal(from: number, data: SignalData) {
    if (!this.channelId) return;
    const peer = this.ensurePeer(from);
    const { pc } = peer;
    try {
      if (data.description) {
        const description = data.description;
        const collision = description.type === 'offer' && (peer.makingOffer || pc.signalingState !== 'stable');
        peer.ignoreOffer = !peer.polite && collision;
        if (peer.ignoreOffer) return;
        await pc.setRemoteDescription(description);
        for (const c of peer.pendingCandidates.splice(0)) await pc.addIceCandidate(c).catch(() => undefined);
        if (description.type === 'offer') {
          await pc.setLocalDescription();
          this.signal(from, { description: pc.localDescription!.toJSON() });
        }
      } else if (data.candidate !== undefined) {
        if (!pc.remoteDescription) {
          if (data.candidate) peer.pendingCandidates.push(data.candidate);
          return;
        }
        try {
          await pc.addIceCandidate(data.candidate ?? undefined);
        } catch (err) {
          if (!peer.ignoreOffer) console.warn('ICE candidate failed', err);
        }
      }
    } catch (err) {
      console.warn('signal handling failed', err);
    }
  }

  private signal(to: number, data: SignalData) {
    getSocket()?.emit('voice:signal', { to, data });
  }

  private ensurePeer(userId: number): Peer {
    const existing = this.peers.get(userId);
    if (existing) return existing;
    const pc = new RTCPeerConnection({ iceServers: this.iceServers });
    const peer: Peer = {
      userId,
      pc,
      polite: this.myId < userId,
      makingOffer: false,
      ignoreOffer: false,
      senders: {},
      streams: new Map(),
      audioEls: new Map(),
      pendingCandidates: [],
    };
    this.peers.set(userId, peer);

    pc.onnegotiationneeded = async () => {
      try {
        peer.makingOffer = true;
        await pc.setLocalDescription();
        this.signal(userId, { description: pc.localDescription!.toJSON() });
      } catch (err) {
        console.warn('negotiation failed', err);
      } finally {
        peer.makingOffer = false;
      }
    };
    pc.onicecandidate = ({ candidate }) => this.signal(userId, { candidate: candidate ? candidate.toJSON() : null });
    pc.onconnectionstatechange = () => {
      useVoice.setState((s) => ({ connection: { ...s.connection, [userId]: pc.connectionState } }));
      if (pc.connectionState === 'failed') pc.restartIce();
    };
    pc.ontrack = ({ track, streams }) => {
      const stream = streams[0] ?? new MediaStream([track]);
      if (!peer.streams.has(stream.id)) {
        peer.streams.set(stream.id, stream);
        stream.onremovetrack = () => {
          if (stream.getTracks().length === 0) {
            peer.streams.delete(stream.id);
            peer.audioEls.get(stream.id)?.remove();
            peer.audioEls.delete(stream.id);
            this.publishRemote(peer);
          }
        };
      }
      if (track.kind === 'audio') this.playAudio(peer, stream);
      track.onended = () => this.publishRemote(peer);
      this.publishRemote(peer);
    };

    // Send what we have; if we have no microphone still ask to receive audio.
    if (this.mic) peer.senders.mic = pc.addTrack(this.mic.getAudioTracks()[0], this.mic);
    else pc.addTransceiver('audio', { direction: 'recvonly' });
    if (this.camera) peer.senders.camera = pc.addTrack(this.camera.getVideoTracks()[0], this.camera);
    if (this.screen) {
      peer.senders.screen = pc.addTrack(this.screen.getVideoTracks()[0], this.screen);
      const a = this.screen.getAudioTracks()[0];
      if (a) peer.senders.screenAudio = pc.addTrack(a, this.screen);
    }
    return peer;
  }

  private publishRemote(peer: Peer) {
    const live = [...peer.streams.values()].filter((s) => s.getTracks().some((t) => t.readyState === 'live'));
    useVoice.setState((s) => ({ remote: { ...s.remote, [peer.userId]: live } }));
  }

  private playAudio(peer: Peer, stream: MediaStream) {
    if (peer.audioEls.has(stream.id)) return;
    const el = document.createElement('audio');
    el.autoplay = true;
    el.srcObject = stream;
    el.dataset.userId = String(peer.userId);
    el.style.display = 'none';
    const prefs = getVoicePrefs();
    el.volume = Math.min(1, Math.max(0, (prefs.volumes[String(peer.userId)] ?? 100) / 100));
    el.muted = useVoice.getState().selfDeaf || this.serverDeaf;
    const sink = (el as HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> }).setSinkId;
    if (prefs.outputId && sink) void sink.call(el, prefs.outputId).catch(() => undefined);
    document.body.appendChild(el);
    void el.play().catch(() => undefined);
    peer.audioEls.set(stream.id, el);
    this.addMeter(peer.userId, stream);
  }

  private closePeer(peer: Peer) {
    peer.pc.onnegotiationneeded = null;
    peer.pc.onicecandidate = null;
    peer.pc.ontrack = null;
    peer.pc.close();
    for (const el of peer.audioEls.values()) el.remove();
    for (const [key, m] of this.meters) {
      if (m.userId === peer.userId) {
        m.source.disconnect();
        this.meters.delete(key);
      }
    }
  }

  // ---------- speaking detection ----------

  private addMeter(userId: number, stream: MediaStream) {
    if (!this.audioCtx || stream.getAudioTracks().length === 0) return;
    const key = `${userId}:${stream.id}`;
    if (this.meters.has(key)) return;
    try {
      const source = this.audioCtx.createMediaStreamSource(stream);
      const analyser = this.audioCtx.createAnalyser();
      analyser.fftSize = 512;
      source.connect(analyser);
      this.meters.set(key, { userId, analyser, source, lastLoud: 0 });
    } catch {
      // ignore streams that cannot be analysed
    }
  }

  private startMeters() {
    const buf = new Float32Array(512);
    this.meterTimer = window.setInterval(() => {
      const now = Date.now();
      const next: Record<number, boolean> = {};
      for (const m of this.meters.values()) {
        m.analyser.getFloatTimeDomainData(buf);
        let sum = 0;
        for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
        const rms = Math.sqrt(sum / buf.length);
        if (rms > SPEAK_THRESHOLD) m.lastLoud = now;
        if (now - m.lastLoud < 350) next[m.userId] = true;
      }
      const state = useVoice.getState();
      if (state.selfMute || this.serverMute) delete next[this.myId];
      const prev = state.speaking;
      const changed = Object.keys(next).length !== Object.keys(prev).length || Object.keys(next).some((k) => !prev[Number(k)]);
      if (changed) useVoice.setState({ speaking: next });
    }, 120);
  }

  /** Current input level 0..1 of my microphone (for the settings meter). */
  micLevel(): number {
    const m = this.meters.get(`${this.myId}:${this.mic?.id}`);
    if (!m) return 0;
    const buf = new Float32Array(512);
    m.analyser.getFloatTimeDomainData(buf);
    let sum = 0;
    for (const v of buf) sum += v * v;
    return Math.min(1, Math.sqrt(sum / buf.length) * 6);
  }

  // ---------- controls ----------

  private applyMicEnabled(selfMute: boolean) {
    const enabled = !selfMute && !this.serverMute;
    this.mic?.getAudioTracks().forEach((t) => (t.enabled = enabled));
  }

  private applyDeaf(selfDeaf: boolean) {
    const muted = selfDeaf || this.serverDeaf;
    for (const peer of this.peers.values()) for (const el of peer.audioEls.values()) el.muted = muted;
  }

  setMute(selfMute: boolean) {
    if (!this.mic && !selfMute) {
      useVoice.setState({ error: 'mic_unavailable' });
      return;
    }
    // Unmuting also undeafens, like most voice apps.
    const selfDeaf = selfMute ? useVoice.getState().selfDeaf : false;
    useVoice.setState({ selfMute, selfDeaf });
    this.applyMicEnabled(selfMute);
    this.applyDeaf(selfDeaf);
    if (this.channelId) getSocket()?.emit('voice:update', { selfMute, selfDeaf });
    (selfMute ? sounds.mute : sounds.unmute)();
  }

  setDeaf(selfDeaf: boolean) {
    const selfMute = selfDeaf ? true : !this.mic ? true : false;
    useVoice.setState({ selfDeaf, selfMute });
    this.applyDeaf(selfDeaf);
    this.applyMicEnabled(selfMute);
    if (this.channelId) getSocket()?.emit('voice:update', { selfMute, selfDeaf });
    (selfDeaf ? sounds.mute : sounds.unmute)();
  }

  setUserVolume(userId: number, percent: number) {
    const prefs = getVoicePrefs();
    setVoicePrefs({ volumes: { ...prefs.volumes, [String(userId)]: percent } });
    const peer = this.peers.get(userId);
    if (peer) for (const el of peer.audioEls.values()) el.volume = Math.min(1, Math.max(0, percent / 100));
  }

  private publishTracks() {
    const s = useVoice.getState();
    getSocket()?.emit('voice:update', {
      video: !!this.camera,
      screen: !!this.screen,
      streams: { camera: this.camera?.id, screen: this.screen?.id },
      selfMute: s.selfMute,
      selfDeaf: s.selfDeaf,
    });
    useVoice.setState({ video: !!this.camera, screen: !!this.screen, localCamera: this.camera, localScreen: this.screen });
  }

  async toggleCamera() {
    if (!this.channelId) return;
    if (this.camera) {
      for (const peer of this.peers.values()) {
        if (peer.senders.camera) peer.pc.removeTrack(peer.senders.camera);
        peer.senders.camera = undefined;
      }
      this.camera.getTracks().forEach((t) => t.stop());
      this.camera = null;
      this.publishTracks();
      return;
    }
    const prefs = getVoicePrefs();
    try {
      this.camera = await navigator.mediaDevices.getUserMedia({
        video: { deviceId: prefs.videoId ? { ideal: prefs.videoId } : undefined, width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } },
      });
    } catch {
      useVoice.setState({ error: 'camera_unavailable' });
      return;
    }
    const track = this.camera.getVideoTracks()[0];
    for (const peer of this.peers.values()) peer.senders.camera = peer.pc.addTrack(track, this.camera);
    this.publishTracks();
  }

  async toggleScreen() {
    if (!this.channelId) return;
    if (this.screen) {
      this.stopScreen();
      return;
    }
    try {
      this.screen = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: 30 } }, audio: true });
    } catch {
      return; // user cancelled the picker
    }
    const video = this.screen.getVideoTracks()[0];
    video.onended = () => this.stopScreen();
    const audioTrack = this.screen.getAudioTracks()[0];
    for (const peer of this.peers.values()) {
      peer.senders.screen = peer.pc.addTrack(video, this.screen);
      if (audioTrack) peer.senders.screenAudio = peer.pc.addTrack(audioTrack, this.screen);
    }
    this.publishTracks();
  }

  private stopScreen() {
    if (!this.screen) return;
    for (const peer of this.peers.values()) {
      for (const key of ['screen', 'screenAudio'] as const) {
        const sender = peer.senders[key];
        if (sender) peer.pc.removeTrack(sender);
        peer.senders[key] = undefined;
      }
    }
    this.screen.getTracks().forEach((t) => t.stop());
    this.screen = null;
    this.publishTracks();
  }

  /** Swap the microphone (device change in settings) without reconnecting. */
  async switchInput(deviceId: string) {
    setVoicePrefs({ inputId: deviceId });
    if (!this.channelId) return;
    const prefs = getVoicePrefs();
    const next = await navigator.mediaDevices.getUserMedia({
      audio: { deviceId: { exact: deviceId }, echoCancellation: prefs.echoCancellation, noiseSuppression: prefs.noiseSuppression },
    });
    const track = next.getAudioTracks()[0];
    for (const peer of this.peers.values()) await peer.senders.mic?.replaceTrack(track);
    this.mic?.getTracks().forEach((t) => t.stop());
    this.mic = next;
    this.addMeter(this.myId, next);
    this.applyMicEnabled(useVoice.getState().selfMute);
  }

  setOutput(deviceId: string) {
    setVoicePrefs({ outputId: deviceId });
    for (const peer of this.peers.values()) {
      for (const el of peer.audioEls.values()) {
        const sink = (el as HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> }).setSinkId;
        if (sink) void sink.call(el, deviceId).catch(() => undefined);
      }
    }
  }
}

export const voice = new VoiceEngine();
