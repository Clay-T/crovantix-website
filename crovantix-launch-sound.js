(function () {
  if (window.__crovantixLaunchSoundReady) return;
  window.__crovantixLaunchSoundReady = true;

  let played = false;

  function playTone(audioContext, start, frequency, duration, gain) {
    const oscillator = audioContext.createOscillator();
    const volume = audioContext.createGain();
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(frequency, start);
    oscillator.frequency.exponentialRampToValueAtTime(frequency * 1.012, start + duration);
    volume.gain.setValueAtTime(0.0001, start);
    volume.gain.exponentialRampToValueAtTime(gain, start + 0.035);
    volume.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    oscillator.connect(volume).connect(audioContext.destination);
    oscillator.start(start);
    oscillator.stop(start + duration + 0.03);
  }

  async function playLaunchSound() {
    if (played || !document.querySelector(".crovantix-launch-screen")) return;
    played = true;
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    const audioContext = new AudioContext();
    if (audioContext.state === "suspended") await audioContext.resume();
    const start = audioContext.currentTime + 0.05;
    playTone(audioContext, start, 523.25, 0.42, 0.045);
    playTone(audioContext, start + 0.18, 659.25, 0.46, 0.038);
    playTone(audioContext, start + 0.38, 783.99, 0.62, 0.034);
    playTone(audioContext, start + 0.66, 1046.5, 0.72, 0.022);
    setTimeout(() => audioContext.close().catch(() => {}), 1800);
  }

  function playWhenAllowed() {
    playLaunchSound().catch(() => {
      played = false;
    });
  }

  window.addEventListener("DOMContentLoaded", () => {
    setTimeout(playWhenAllowed, 180);
    ["pointerdown", "touchstart", "keydown"].forEach(eventName => {
      window.addEventListener(eventName, playWhenAllowed, { once: true, passive: true });
    });
  });
})();
