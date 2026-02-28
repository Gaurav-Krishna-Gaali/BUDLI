const run = {
    id: "123",
    name: "test",
    status: "pending",
    createdAt: "2023-01-01T00:00:00Z",
    devices: [],
    results: [],
    feedbackSubmitted: false
};

fetch('http://localhost:8000/runs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(run)
})
    .then(r => console.log(r.status))
    .catch(console.error);
