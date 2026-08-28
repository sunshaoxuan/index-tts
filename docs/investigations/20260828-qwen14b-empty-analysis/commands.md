# Commands

```powershell
Invoke-RestMethod http://127.0.0.1:7864/api/settings/ai-media
Invoke-RestMethod http://127.0.0.1:11434/api/tags
Get-Content runtime-output\product-jobs\87c31961becf409a8d4419fe9326a857\input.json
Get-Content runtime-output\product-jobs\87c31961becf409a8d4419fe9326a857\status.json
Get-Content runtime-output\product-jobs\87c31961becf409a8d4419fe9326a857\worker.log
Get-Content runtime-output\product-jobs\b7101dbdcf0e4675979ef0c50292ccf0\input.json
Get-Content runtime-output\product-jobs\b7101dbdcf0e4675979ef0c50292ccf0\status.json
Get-Content runtime-output\product-jobs\09838d0fc3ed404e93e392817d9cb4fe\input.json
Get-Content runtime-output\product-jobs\09838d0fc3ed404e93e392817d9cb4fe\status.json
Get-Content runtime-output\product-jobs\09838d0fc3ed404e93e392817d9cb4fe\worker.log
.\.venv\Scripts\python.exe -m pytest tests\test_product_analysis_worker.py tests\test_text_director.py tests\test_text_director_worker.py tests\test_novel_project.py tests\test_character_assets.py -q
.\.venv\Scripts\python.exe -m pytest tests\test_text_director.py tests\test_text_director_worker.py tests\test_novel_project.py tests\test_character_assets.py -q
pnpm test
pnpm build
git diff --check
```
