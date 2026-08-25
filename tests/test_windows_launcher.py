from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
LAUNCHER = ROOT / "scripts" / "start_indextts25_windows.ps1"


def test_windows_launcher_starts_node_product_architecture():
    content = LAUNCHER.read_text(encoding="utf-8")
    assert '[int]$Port = 7864' in content
    assert 'Get-NetTCPConnection -LocalPort $Port' in content
    assert 'Stop-Process -Id $existingListener.OwningProcess' in content
    assert '[int]$Port = 7864,' not in content
    assert 'Node.js 24 LTS' in content
    assert 'product-studio' in content
    assert 'server/index.mjs' in content
    assert 'production_webui.py' not in content
    assert '$env:PYTHONUTF8 = "1"' in content


def test_windows_launcher_builds_with_locked_pnpm_dependencies():
    content = LAUNCHER.read_text(encoding="utf-8")
    assert 'pnpm install --frozen-lockfile' in content
    assert '& $pnpm build' in content
    assert 'INDEXTTS_NODE' in content
    assert 'INDEXTTS_PNPM' in content
    assert 'if (-not $SkipBuild)' in content
    assert r'dist\index.html' not in content
    assert '$env:USERPROFILE' in content


def test_product_runtime_files_exist():
    for relative in (
        "product-studio/package.json",
        "product-studio/pnpm-lock.yaml",
        "product-studio/src/App.tsx",
        "product-studio/server/index.mjs",
        "product_analysis_worker.py",
        "product_render_worker.py",
    ):
        assert (ROOT / relative).is_file(), relative
