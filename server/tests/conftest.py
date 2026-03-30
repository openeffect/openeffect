import sys
from pathlib import Path

# Add server/ to sys.path so imports like `from config.settings import ...` work
sys.path.insert(0, str(Path(__file__).parent.parent))
