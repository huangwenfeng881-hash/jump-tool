# -*- coding: utf-8 -*-
import pathlib
P = pathlib.Path(r"D:/jump app/js/supabase-config.js")
s = P.read_text(encoding="utf-8")
block = pathlib.Path(r"D:/jump app/_proxy_block.js").read_text(encoding="utf-8")
start = s.index("  PROXY_URL:")
end = s.index("  // ", s.index("PROXY_URL:"))
s = s[:start] + block + s[end:]
P.write_text(s, encoding="utf-8")
print("ok")