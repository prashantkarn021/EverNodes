let network = null;

document.getElementById("generate-btn").addEventListener("click", async () => {
    const goal = document.getElementById("goal").value.trim();
    const prior = document.getElementById("prior").value.trim();

    if (!goal) {
        document.getElementById("status").textContent = "Please enter what you want to learn.";
        return;
    }

    document.getElementById("status").textContent = "Building your learning map...";
    document.getElementById("generate-btn").disabled = true;

    try {
        const response = await fetch("/everNodes", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ goal, prior })
        });

        const data = await response.json();

        if (data.error) {
            document.getElementById("status").textContent = "Something went wrong. Try again.";
            document.getElementById("generate-btn").disabled = false;
            return;
        }

        renderGraph(data, goal);

    } catch (err) {
        document.getElementById("status").textContent = "Network error. Is the server running?";
        document.getElementById("generate-btn").disabled = false;
    }
});

function renderGraph(data, goal) {
    document.getElementById("input-screen").style.display = "none";
    document.getElementById("graph-screen").style.display = "flex";
    document.getElementById("graph-title").textContent = goal;

    const nodes = new vis.DataSet(
        data.nodes.map(node => ({
            id: node.id,
            label: node.label,
            title: node.description,
            description: node.description,
            color: {
                background: data.known.includes(node.id) ? "#22c55e" : "#1e293b",
                border: data.known.includes(node.id) ? "#16a34a" : "#475569",
                highlight: {
                    background: data.known.includes(node.id) ? "#16a34a" : "#334155",
                    border: "#94a3b8"
                }
            },
            font: { color: "#f1f5f9", size: 14 },
            shape: "box",
            margin: 10
        }))
    );

    const edges = new vis.DataSet(
        data.edges.map(edge => ({
            from: edge.from,
            to: edge.to,
            arrows: "to",
            color: { color: "#475569" },
            smooth: { type: "cubicBezier" }
        }))
    );

    const container = document.getElementById("graph-container");

    network = new vis.Network(container, { nodes, edges }, {
        layout: {
            hierarchical: {
                direction: "UD",
                sortMethod: "directed",
                levelSeparation: 100,
                nodeSpacing: 150
            }
        },
        physics: false,
        interaction: { hover: true }
    });

    network.on("click", function(params) {
        if (params.nodes.length > 0) {
            const nodeId = params.nodes[0];
            const node = data.nodes.find(n => n.id === nodeId);
            if (node) {
                document.getElementById("node-description").textContent = node.description;
            }
        }
    });
}

document.getElementById("back-btn").addEventListener("click", () => {
    document.getElementById("graph-screen").style.display = "none";
    document.getElementById("input-screen").style.display = "flex";
    document.getElementById("status").textContent = "";
    document.getElementById("generate-btn").disabled = false;
    document.getElementById("goal").value = "";
    document.getElementById("prior").value = "";
    document.getElementById("node-description").textContent = "Click any node to learn more about it";
    if (network) {
        network.destroy();
        network = null;
    }
});