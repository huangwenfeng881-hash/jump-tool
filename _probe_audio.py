# -*- coding: utf-8 -*-
import wave, pathlib, json
p = pathlib.Path(r"D:/jump app/1.drawai.media/audio-f4f29d47-6a5d-48e2-ac0a-ca3c577676ff/audio.wav")
with wave.open(str(p), "rb") as w:
    print("ch", w.getnchannels(), "sr", w.getframerate(), "frames", w.getnframes(), "sec", round(w.getnframes()/w.getframerate(),2))
