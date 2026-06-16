#!/usr/bin/env node
const response = await fetch("http://127.0.0.1:3000/api/hermes/morning-digest/latest");
const data = await response.json();
console.log(JSON.stringify(data, null, 2));
