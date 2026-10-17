"""pytest root for the ml/ workspace.

Its presence makes ``ml/`` the rootdir and puts it on ``sys.path`` (prepend
import mode), so ``import payguard_ml`` works without an editable install.
"""

import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
