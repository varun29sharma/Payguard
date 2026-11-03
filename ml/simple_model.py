"""
simple_model.py — PayGuard's Python part, kept deliberately small.

Purpose: show, in one file you can read top to bottom, how a machine-learning
model would learn fraud patterns from labelled transactions — as an OFFLINE
experiment. It is NOT part of the live system: live decisions are made by the
Java rules engine. This script answers "could a model learn this?" and
reports honest numbers.

It uses only the Python standard library (no pip installs) and implements
logistic regression directly, so every step can be explained:

  1. make_sample_data()  -> create labelled transactions (fraud / not fraud)
  2. to_features()       -> turn one transaction into 4 numbers (a vector)
  3. train()             -> learn one weight per feature (gradient descent)
  4. predict()           -> turn a feature vector into a probability 0..1
  5. evaluate()          -> accuracy, precision, recall on held-out data
  6. main()              -> run all of the above and print the result

Run it:  python3 ml/simple_model.py
"""

import math
import random

# ---------------------------------------------------------------------------
# 1. Sample data
# ---------------------------------------------------------------------------

def make_sample_data(count=1000, seed=42):
    """Create `count` fake transactions, each labelled fraud (1) or not (0).

    The patterns planted here mirror the Java rules: fraud is more likely for
    very large amounts, at night, from a brand-new device, and when the user
    has already made many transactions in the last hour. A transaction is
    labelled fraud with a probability that grows with those signals — the
    model below has to *discover* that relationship from the data alone.
    """
    rng = random.Random(seed)
    rows = []
    for _ in range(count):
        txn = {
            "amount": round(rng.uniform(10, 200_000), 2),   # rupees
            "hour": rng.randint(0, 23),                     # hour of day
            "txns_last_hour": rng.randint(0, 12),           # user's recent count
            "new_device": rng.random() < 0.2,               # device never seen
        }
        # Hidden scoring the model never sees — it only sees the label.
        risk = 0.02
        if txn["amount"] > 100_000:
            risk += 0.35
        if txn["hour"] < 5:
            risk += 0.20
        if txn["txns_last_hour"] > 5:
            risk += 0.25
        if txn["new_device"]:
            risk += 0.20
        txn["is_fraud"] = 1 if rng.random() < risk else 0
        rows.append(txn)
    return rows


# ---------------------------------------------------------------------------
# 2. Features
# ---------------------------------------------------------------------------

FEATURE_NAMES = ["amount (scaled)", "is night", "txns last hour (scaled)", "new device"]


def to_features(txn):
    """Turn one transaction into a list of 4 numbers, each roughly 0..1.

    Scaling matters: amount is in rupees (up to 200,000) while the other
    features are 0..1. Without scaling, the large feature would dominate
    training. Dividing by a typical maximum puts them on the same scale.
    """
    return [
        txn["amount"] / 200_000,
        1.0 if txn["hour"] < 5 else 0.0,
        txn["txns_last_hour"] / 12,
        1.0 if txn["new_device"] else 0.0,
    ]


# ---------------------------------------------------------------------------
# 3 + 4. The model: logistic regression
# ---------------------------------------------------------------------------

def sigmoid(z):
    """Squash any number into a probability between 0 and 1."""
    return 1 / (1 + math.exp(-z))


def train(rows, epochs=300, learning_rate=0.5):
    """Learn one weight per feature, plus a bias, by gradient descent.

    For each transaction: predict a probability, compare it with the true
    label, and nudge every weight a little in the direction that would have
    made the prediction better. Repeat over the whole dataset `epochs` times.
    A positive learned weight means "more of this feature -> more fraud risk".
    """
    weights = [0.0] * len(FEATURE_NAMES)
    bias = 0.0
    for _ in range(epochs):
        for txn in rows:
            x = to_features(txn)
            error = predict(weights, bias, x) - txn["is_fraud"]  # how wrong we were
            for i in range(len(weights)):
                weights[i] -= learning_rate * error * x[i]       # nudge weight i
            bias -= learning_rate * error                        # nudge the bias
    return weights, bias


def predict(weights, bias, features):
    """Probability of fraud = sigmoid(bias + weight1*x1 + ... + weight4*x4)."""
    z = bias + sum(w * x for w, x in zip(weights, features))
    return sigmoid(z)


# ---------------------------------------------------------------------------
# 5. Evaluation
# ---------------------------------------------------------------------------

def evaluate(weights, bias, rows, threshold=0.5):
    """Score the model on data it did not train on.

    A prediction counts as "fraud" when its probability is >= threshold.
    - accuracy : all correct predictions / all predictions
    - precision: of the transactions we CALLED fraud, how many really were
                 (low precision = analysts drown in false alarms)
    - recall   : of the REAL fraud, how much did we catch
                 (low recall = fraud slips through)
    """
    true_pos = false_pos = false_neg = correct = 0
    for txn in rows:
        predicted = 1 if predict(weights, bias, to_features(txn)) >= threshold else 0
        actual = txn["is_fraud"]
        if predicted == actual:
            correct += 1
        if predicted == 1 and actual == 1:
            true_pos += 1
        elif predicted == 1 and actual == 0:
            false_pos += 1
        elif predicted == 0 and actual == 1:
            false_neg += 1
    total = len(rows)
    return {
        "accuracy": correct / total,
        "precision": true_pos / (true_pos + false_pos) if true_pos + false_pos else 0.0,
        "recall": true_pos / (true_pos + false_neg) if true_pos + false_neg else 0.0,
        "tested": total,
    }


# ---------------------------------------------------------------------------
# 6. Run it
# ---------------------------------------------------------------------------

def main():
    rows = make_sample_data()
    split = int(len(rows) * 0.8)              # 80% train, 20% test
    train_rows, test_rows = rows[:split], rows[split:]

    weights, bias = train(train_rows)
    results = evaluate(weights, bias, test_rows)

    print("PayGuard — simple logistic regression (offline experiment)")
    print(f"Trained on {len(train_rows)} transactions, tested on {results['tested']}")
    print("\nWhat the model learned (positive weight = raises fraud risk):")
    for name, w in zip(FEATURE_NAMES, weights):
        print(f"  {name:<26} weight {w:+.2f}")
    print(f"  {'bias':<26}        {bias:+.2f}")
    print(f"\nAccuracy : {results['accuracy']:.2f}")
    print(f"Precision: {results['precision']:.2f}  (of flagged, how many were real fraud)")
    print(f"Recall   : {results['recall']:.2f}  (of real fraud, how much we caught)")
    print("\nNote: this data is synthetic, so these numbers show the method works —")
    print("they are not a claim about real-world fraud detection.")


if __name__ == "__main__":
    main()
