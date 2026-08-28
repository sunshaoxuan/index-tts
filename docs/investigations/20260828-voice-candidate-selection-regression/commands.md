# 调查与验证命令

```powershell
git status --short --branch
rg -n "voice_candidates|candidate_count|selected|gender_pitch_matches" product-studio voice_design_worker.py product_voice_worker.py text_director.py tests docs
Invoke-RestMethod http://127.0.0.1:7864/api/jobs/8f4fb17444724ef4a015b7e2d404272c
python -m pytest tests/test_product_analysis_worker.py tests/test_text_director.py tests/test_voice_design_worker.py -q
python -m pytest -q
pnpm test
pnpm build
git diff --check
```

真实部署与浏览器验收命令将在完成后补充。
