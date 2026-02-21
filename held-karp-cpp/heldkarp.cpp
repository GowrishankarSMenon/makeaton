#include <bits/stdc++.h>
using namespace std;

static const double INF = 1e18;

int main() {
    ios::sync_with_stdio(false);
    cin.tie(nullptr);

    int n;
    cin >> n;

    vector<vector<double>> dist(n, vector<double>(n));
    for (int i = 0; i < n; i++)
        for (int j = 0; j < n; j++)
            cin >> dist[i][j];

    if (n == 1) {
        cout << "0\n0\n";
        return 0;
    }

    int N = n - 1;                 // exclude start node 0
    int FULL = 1 << N;

    vector<double> dp(FULL * n, INF);
    vector<int> parent(FULL * n, -1);

    auto IDX = [&](int mask, int u) { return mask * n + u; };

    // base: from start → each node
    for (int u = 1; u < n; u++) {
        int m = 1 << (u - 1);
        dp[IDX(m, u)] = dist[0][u];
    }

    for (int mask = 1; mask < FULL; mask++) {
        for (int u = 1; u < n; u++) {
            if (!(mask & (1 << (u - 1)))) continue;

            double cur = dp[IDX(mask, u)];
            if (cur >= INF) continue;

            int remaining = ((FULL - 1) ^ mask);

            while (remaining) {
                int bit = remaining & -remaining;
                int v = __builtin_ctz(bit) + 1;
                remaining ^= bit;

                int newMask = mask | (1 << (v - 1));
                double newCost = cur + dist[u][v];

                double &ref = dp[IDX(newMask, v)];
                if (newCost < ref) {
                    ref = newCost;
                    parent[IDX(newMask, v)] = u;
                }
            }
        }
    }

    double best = INF;
    int last = -1;
    int finalMask = FULL - 1;

    for (int u = 1; u < n; u++) {
        double cost = dp[IDX(finalMask, u)] + dist[u][0];
        if (cost < best) {
            best = cost;
            last = u;
        }
    }

    // reconstruct tour
    vector<int> tour = {0};
    vector<int> path;

    int mask = finalMask;
    int cur = last;

    while (cur != -1) {
        path.push_back(cur);
        int p = parent[IDX(mask, cur)];
        mask ^= (1 << (cur - 1));
        cur = p;
    }

    reverse(path.begin(), path.end());

    for (int v : path) tour.push_back(v);
    tour.push_back(0);

    cout << best << "\n";
    for (int v : tour) cout << v << " ";
    cout << "\n";

    return 0;
}