# ml/ — the Python part

One file: **`simple_model.py`**. That is deliberate.

- **What it is:** an offline experiment showing how a logistic-regression model learns fraud patterns from labelled transactions. Pure Python standard library — no pip installs, no services to run.
- **What it is not:** part of the live system. Live decisions are made by the Java rules engine (`fraud-engine/`). Nothing in the live path calls this file.
- **Run it:** `python3 ml/simple_model.py`
- **How to explain it:** data → features → train (gradient descent learns one weight per feature) → predict (sigmoid turns the weighted sum into a probability) → evaluate (accuracy / precision / recall on data the model never trained on). Every function in the file has a plain-English docstring saying exactly that.
