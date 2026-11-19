"""Loads the feature and model definitions out of train_model.ipynb.

The notebook is where the feature code is explained and where it lives, so there is exactly one copy.
The other scripts (own-clip training, diagnostics) call load() to get the same functions
instead of keeping a second copy that could drift apart.
"""
from pathlib import Path

import nbformat
import numpy as np
from sklearn.ensemble import RandomForestClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import accuracy_score, confusion_matrix, f1_score, roc_auc_score
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

NOTEBOOK = Path(__file__).resolve().parent / "train_model.ipynb"


def load():
    """Returns a namespace with: signals, summarise, STATS, joint_angle, scores, logistic, forest, ..."""
    src = [c.source for c in nbformat.read(NOTEBOOK, 4).cells if c.cell_type == "code"]

    def pick(prefix):
        return next(s for s in src if s.startswith(prefix))

    ns = {"np": np, "RandomForestClassifier": RandomForestClassifier, "LogisticRegression": LogisticRegression,
          "accuracy_score": accuracy_score, "confusion_matrix": confusion_matrix, "f1_score": f1_score,
          "roc_auc_score": roc_auc_score, "make_pipeline": make_pipeline, "StandardScaler": StandardScaler}
    exec(pick("# MediaPipe numbers").split("SIG = {}")[0], ns)           # angle signals
    exec(pick("STATS =").split("X, Y, WHO, VIEW, FEATURES")[0], ns)      # summarise()
    exec(pick("def leave_one_person_out"), ns)                           # leave_one_person_out(), scores()
    exec(pick("def always_correct").split("PROB = {name")[0], ns)        # logistic(), forest()
    return ns
