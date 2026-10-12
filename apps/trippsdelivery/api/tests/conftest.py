import os
import sys
import tempfile
from pathlib import Path

# app.main builds the production app at import time, so give it a throwaway database.
os.environ.setdefault("TRIPPS_DB", str(Path(tempfile.mkdtemp()) / "import.db"))
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
