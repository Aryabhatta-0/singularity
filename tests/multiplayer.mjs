import { chromium } from "@playwright/test";
import assert from "node:assert/strict";

const server = process.env.SPACETIMEDB_URI || process.env.SPACETIMEDB_HTTP_URI || "http://127.0.0.1:3000";
const database = process.env.SPACETIMEDB_DATABASE || process.env.SPACETIMEDB_MODULE || "singularity";
const localHosts = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);
if (
  !localHosts.has(new URL(server).hostname) ||
  !/^singularity(?:-|$)/.test(database)
) {
  throw new Error("Refusing to run mutating multiplayer tests outside the local database.");
}

const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  const page = await browser.newPage();
  await page.routeWebSocket(url => url.port === "5173", socket => socket.close());
  await page.goto(process.env.TEST_URL || "http://127.0.0.1:5173");

  const report = await page.evaluate(async ({ server, database }) => {
    const { DbConnection } = await import("/src/module_bindings/index.ts");
    const { connect: connectGameNetwork } = await import("/src/network.ts");
    const { CHALLENGE, RULESET, rolesFor, teammateInputs } = await import("/shared/physics.ts");
    const { DISCONNECT_GRACE_MICROS } = await import("/shared/match-lifecycle.ts");
    const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
    const check = (ok, message) => { if (!ok) throw new Error(message); };
    const reject = async (operation, message) => {
      try {
        await operation();
      } catch {
        return;
      }
      throw new Error(message);
    };
    const waitFor = async (predicate, message, timeout = 6000) => {
      const deadline = Date.now() + timeout;
      while (Date.now() < deadline) {
        const value = predicate();
        if (value) return value;
        await wait(50);
      }
      throw new Error(message);
    };
    const open = (token, queries) => new Promise((resolve, rejectConnection) => {
      DbConnection.builder()
        .withUri(server)
        .withDatabaseName(database)
        .withToken(token)
        .onConnect((connection, _identity, nextToken) => {
          const connected = () => resolve({ connection, token: nextToken });
          if (!queries) {
            connected();
            return;
          }
          connection.subscriptionBuilder()
            .onApplied(connected)
            .onError(context => rejectConnection(new Error(String(context.event))))
            .subscribe(queries);
        })
        .onConnectError((_context, error) => rejectConnection(error))
        .build();
    });

    const nonce = Date.now().toString(36).toUpperCase().slice(-7);
    const verifyRoomSubscriptionScope = async () => {
      const connections = [];
      const codeA = `S3A${nonce}`;
      const codeB = `S3B${nonce}`;
      let scopedNetwork;
      try {
        const hostA = await open();
        const hostB = await open();
        connections.push(hostA.connection, hostB.connection);
        const joinArgs = code => ({
          code,
          name: `Scope ${code}`,
          teamNumber: 0,
          role: 0,
          ruleset: RULESET,
          challenge: CHALLENGE.Easy,
          crewSize: 3,
        });
        await hostA.connection.reducers.join(joinArgs(codeA));
        await hostB.connection.reducers.join(joinArgs(codeB));

        let networkError;
        let readyNetwork;
        const readyPromise = new Promise(resolve => { readyNetwork = resolve; });
        const roomEvents = [];
        scopedNetwork = connectGameNetwork({
          ready: readyNetwork,
          roomData: code => roomEvents.push(code),
          leaderboardData: () => {},
          error: message => { networkError = message; },
        });
        await readyPromise;
        scopedNetwork.setRoom(codeA);
        await waitFor(
          () => roomEvents.includes(codeA) && scopedNetwork.connection.db.room.id.find(codeA),
          "scoped network did not expose room A",
        );
        check(!scopedNetwork.connection.db.room.id.find(codeB), "room A scope leaked room B");
        check(
          [...scopedNetwork.connection.db.player.iter()].every(row => row.room === codeA),
          "room A scope leaked another room's players",
        );
        check(
          [...scopedNetwork.connection.db.team.iter()].every(row => row.room === codeA),
          "room A scope leaked another room's teams",
        );

        scopedNetwork.setRoom(codeB);
        await waitFor(
          () => roomEvents.includes(codeB) && scopedNetwork.connection.db.room.id.find(codeB),
          "scoped network did not expose room B",
        );
        await waitFor(
          () => !scopedNetwork.connection.db.room.id.find(codeA),
          "switching scope retained room A",
        );
        check(!networkError, `scoped network failed: ${networkError}`);
        await hostA.connection.reducers.leave({});
        await hostB.connection.reducers.leave({});
      } finally {
        scopedNetwork?.disconnect();
        connections.forEach(connection => connection.disconnect());
      }
    };
    const verifyReplacementConnectionOwnsLease = async () => {
      const connections = [];
      const code = `R50${nonce}`;
      try {
        const first = await open();
        connections.push(first.connection);
        const observer = await open(undefined, [
          `SELECT * FROM room WHERE id = '${code}'`,
          `SELECT * FROM player WHERE room = '${code}'`,
        ]);
        connections.push(observer.connection);
        const joinArgs = {
          code,
          name: "Replacement connection",
          teamNumber: 0,
          role: 0,
          ruleset: RULESET,
          challenge: CHALLENGE.Easy,
          crewSize: 5,
        };
        await first.connection.reducers.join(joinArgs);
        await waitFor(
          () => observer.connection.db.player.id.find(first.connection.identity)?.online,
          "initial connection did not claim its player lease",
        );

        const replacement = await open(first.token);
        connections.push(replacement.connection);
        check(replacement.connection.identity.isEqual(first.connection.identity), "replacement token changed identity");
        await replacement.connection.reducers.join(joinArgs);
        await first.connection.reducers.leave({});
        first.connection.disconnect();
        await wait(250);
        check(
          observer.connection.db.player.id.find(replacement.connection.identity)?.online === true,
          "stale connection released the replacement player's lease",
        );
        await replacement.connection.reducers.leave({});
        await waitFor(
          () => !observer.connection.db.player.id.find(replacement.connection.identity),
          "replacement connection could not release its own lease",
        );
      } finally {
        connections.forEach(connection => connection.disconnect());
      }
    };
    const verifyLeaderboardSubscriptionScope = async () => {
      let scopedNetwork;
      try {
        let networkError;
        let readyNetwork;
        const readyPromise = new Promise(resolve => { readyNetwork = resolve; });
        const applied = [];
        scopedNetwork = connectGameNetwork({
          ready: readyNetwork,
          roomData: () => {},
          leaderboardData: scope => applied.push(`${scope.challenge}:${scope.crewSize}`),
          error: message => { networkError = message; },
        });
        await readyPromise;
        scopedNetwork.setLeaderboard({ challenge: CHALLENGE.Difficult, crewSize: 3 });
        await waitFor(
          () => applied.includes(`${CHALLENGE.Difficult}:3`) && [...scopedNetwork.connection.db.result.iter()].length > 0,
          "Difficult/3 leaderboard scope did not apply",
        );
        check(
          [...scopedNetwork.connection.db.result.iter()].every(row => row.ruleset === RULESET && row.challenge === CHALLENGE.Difficult && row.crewSize === 3),
          "Difficult/3 leaderboard leaked another result category",
        );
        scopedNetwork.setLeaderboard({ challenge: CHALLENGE.Easy, crewSize: 5 });
        await waitFor(
          () => applied.includes(`${CHALLENGE.Easy}:5`) && [...scopedNetwork.connection.db.result.iter()].some(row => row.challenge === CHALLENGE.Easy && row.crewSize === 5),
          "Easy/5 leaderboard scope did not apply",
        );
        check(
          [...scopedNetwork.connection.db.result.iter()].every(row => row.ruleset === RULESET && row.challenge === CHALLENGE.Easy && row.crewSize === 5),
          "Easy/5 leaderboard retained another result category",
        );
        check(!networkError, `leaderboard scope failed: ${networkError}`);
      } finally {
        scopedNetwork?.disconnect();
      }
    };
    const runRoom = async ({ label, challenge, crewSize, exerciseReconnect }) => {
      const connections = [];
      const connectClient = async (token, queries) => {
        const session = await open(token, queries);
        connections.push(session.connection);
        return session;
      };
      const clients = [];
      const clientTokens = [];
      let observer;

      try {
        for (let role = 0; role < crewSize; role++) {
          const session = await connectClient();
          clients.push(session.connection);
          clientTokens.push(session.token);
        }
        const outsider = (await connectClient()).connection;
        const code = `Q${crewSize}${challenge}${nonce}`;
        observer = (await connectClient(undefined, [
          `SELECT * FROM room WHERE id = '${code}'`,
          `SELECT * FROM player WHERE room = '${code}'`,
          `SELECT * FROM team WHERE room = '${code}'`,
          `SELECT * FROM result WHERE room = '${code}'`,
        ])).connection;
        const joinArgs = role => ({
          code,
          name: `${label} Pilot ${role + 1}`,
          teamNumber: 0,
          role,
          ruleset: RULESET,
          challenge,
          crewSize,
        });

        await reject(
          () => outsider.reducers.join({ ...joinArgs(0), role: crewSize }),
          `${crewSize}-player room accepted role ${crewSize}`,
        );
        await reject(
          () => outsider.reducers.join({ ...joinArgs(0), ruleset: RULESET - 1 }),
          `${label} room accepted an obsolete ruleset`,
        );

        await clients[0].reducers.join(joinArgs(0));
        const room = await waitFor(
          () => observer.db.room.id.find(code),
          `${label} room was not created`,
        );
        check(room.challenge === challenge && room.crewSize === crewSize, `${label} room lost its configuration`);
        const initialTeam = await waitFor(
          () => observer.db.team.id.find(`${code}:0`),
          `${label} team was not created`,
        );
        const initialBody = JSON.parse(initialTeam.body);
        check(initialBody.challenge === challenge && initialBody.crewSize === crewSize, `${label} body used the wrong mode`);

        const otherChallenge = challenge === CHALLENGE.Difficult ? CHALLENGE.Medium : CHALLENGE.Difficult;
        const otherCrewSize = crewSize === 3 ? 5 : 3;
        await reject(
          () => outsider.reducers.join({ ...joinArgs(0), challenge: otherChallenge }),
          `${label} room accepted a mismatched challenge`,
        );
        await reject(
          () => outsider.reducers.join({ ...joinArgs(0), crewSize: otherCrewSize }),
          `${label} room accepted a mismatched crew size`,
        );
        await reject(() => clients[0].reducers.start({}), `${label} incomplete crew started with one pilot`);
        await reject(
          () => clients[1].reducers.join({ ...joinArgs(1), role: 0 }),
          `${label} room accepted a duplicate role`,
        );

        for (let role = 1; role < crewSize; role++) {
          await clients[role].reducers.join(joinArgs(role));
          if (role < crewSize - 1) {
            await reject(
              () => clients[0].reducers.start({}),
              `${label} room started before all ${crewSize} roles were present`,
            );
          }
        }
        await waitFor(
          () => [...observer.db.player.iter()].filter(player => player.room === code && player.online).length === crewSize,
          `${label} room did not expose all ${crewSize} connected roles`,
        );
        check(rolesFor(crewSize).length === crewSize, `${label} role contract does not match its crew size`);
        await reject(() => clients[1].reducers.start({}), `${label} non-host started the race`);

        await clients[0].reducers.start({});
        await waitFor(
          () => observer.db.room.id.find(code)?.state === "countdown",
          `${label} room did not enter countdown`,
        );
        await reject(
          () => clients[0].reducers.join({ ...joinArgs(0), role: 1 }),
          `${label} countdown allowed a role switch`,
        );
        await reject(
          () => clients[0].reducers.join({ ...joinArgs(0), code: `${code}X` }),
          `${label} countdown allowed a room hop`,
        );
        await clients[crewSize - 1].reducers.leave({});
        await reject(
          () => clients[crewSize - 1].reducers.join({ ...joinArgs(crewSize - 1), role: 0 }),
          `${label} leave/rejoin changed a locked role`,
        );
        await clients[crewSize - 1].reducers.join(joinArgs(crewSize - 1));

        await waitFor(
          () => observer.db.room.id.find(code)?.state === "racing",
          `${label} room did not start racing`,
          7000,
        );
        await reject(
          () => outsider.reducers.join(joinArgs(0)),
          `${label} room accepted a late pilot`,
        );

        if (exerciseReconnect) {
          const disconnectedIdentity = clients[0].identity;
          clients[0].disconnect();
          await waitFor(
            () => {
              const currentRoom = observer.db.room.id.find(code);
              return currentRoom && !currentRoom.host.isEqual(disconnectedIdentity);
            },
            `${label} host did not migrate`,
          );
          check(
            [...observer.db.player.iter()].find(player => player.room === code && player.role === 0)?.online === false,
            `${label} disconnected pilot lost its role lease`,
          );
          const reconnected = await connectClient(clientTokens[0]);
          clients[0] = reconnected.connection;
          await reject(
            () => clients[0].reducers.join({ ...joinArgs(0), role: 1 }),
            `${label} reconnect changed the leased role`,
          );
          await clients[0].reducers.join(joinArgs(0));
        }

        await wait(35);
        const torsoRole = crewSize === 3 ? 1 : 2;
        await reject(
          () => clients[torsoRole].reducers.input({ x: Number.NaN, z: 0, action: false }),
          `${label} room accepted a NaN input`,
        );
        await clients[torsoRole].reducers.input({ x: 99, z: -99, action: true });
        await waitFor(
          () => {
            const player = observer.db.player.id.find(clients[torsoRole].identity);
            return player?.x === 1 && player.z === -1;
          },
          `${label} input was not bounded`,
        );
        await wait(650);
        await waitFor(
          () => JSON.parse(observer.db.team.id.find(`${code}:0`).body).brace === false,
          `${label} stale action kept affecting the body`,
        );

        const finishDeadline = Date.now() + 150000;
        let result;
        while (Date.now() < finishDeadline) {
          result = [...observer.db.result.iter()].find(row => row.room === code);
          if (result) break;
          const team = observer.db.team.id.find(`${code}:0`);
          check(team, `${label} team disappeared during its race`);
          const body = JSON.parse(team.body);
          const inputs = teammateInputs(body);
          check(inputs.length === crewSize, `${label} generated ${inputs.length} inputs for ${crewSize} pilots`);
          await Promise.all(inputs.map((input, role) => clients[role].reducers.input(input)));
          await wait(50);
        }
        result ??= [...observer.db.result.iter()].find(row => row.room === code);
        check(result, `${label} crew did not finish before the deadline`);
        check(result.ruleset === RULESET, `${label} result used the wrong ruleset`);
        check(result.challenge === challenge, `${label} result used the wrong challenge category`);
        check(result.crewSize === crewSize, `${label} result used the wrong crew-size category`);
        check(result.names.split(", ").length === crewSize, `${label} result recorded the wrong roster size`);
        check(Number.isInteger(result.timeMs) && result.timeMs > 0, `${label} result did not preserve exact milliseconds`);
        await waitFor(
          () => observer.db.room.id.find(code)?.state === "finished",
          `${label} room did not finish after its crew`,
        );

        const rematchHostIdentity = observer.db.room.id.find(code).host;
        const rematchHost = clients.find(client => client.identity.isEqual(rematchHostIdentity));
        check(rematchHost, `${label} rematch host was unavailable`);
        await rematchHost.reducers.start({});
        await waitFor(
          () => observer.db.room.id.find(code)?.state === "countdown",
          `${label} rematch did not start`,
        );
        const resetTeam = observer.db.team.id.find(`${code}:0`);
        const resetBody = JSON.parse(resetTeam.body);
        check(resetTeam.finishMs === 0 && resetBody.stage === 0, `${label} rematch did not reset progress`);
        check(resetTeam.challenge === challenge && resetTeam.crewSize === crewSize, `${label} rematch lost its category`);

        await Promise.all(clients.map(client => client.reducers.leave({})));
        await wait(100);
        check(observer.db.room.id.find(code), `${label} skipped its reconnect grace after a whole-crew drop`);
        await waitFor(
          () => !observer.db.room.id.find(code),
          `${label} empty room was not removed after reconnect grace`,
          Number(DISCONNECT_GRACE_MICROS / 1000n) + 3000,
        );
        check([...observer.db.player.iter()].every(player => player.room !== code), `${label} role leases were not cleaned`);
        check([...observer.db.team.iter()].every(team => team.room !== code), `${label} team rows were not cleaned`);
        check([...observer.db.result.iter()].filter(row => row.room === code).length === 1, `${label} persisted result was lost`);

        return {
          label,
          challenge: result.challenge,
          crewSize: result.crewSize,
          timeMs: result.timeMs,
        };
      } finally {
        connections.forEach(connection => connection.disconnect());
      }
    };

    const verifyAbandonedTeamDoesNotBlock = async () => {
      const connections = [];
      const clients = [[], []];
      const code = `A30${nonce}`;
      let observer;
      try {
        for (let team = 0; team < 2; team++) {
          for (let role = 0; role < 3; role++) {
            const session = await open();
            connections.push(session.connection);
            clients[team].push(session.connection);
          }
        }
        observer = (await open(undefined, [
          `SELECT * FROM room WHERE id = '${code}'`,
          `SELECT * FROM player WHERE room = '${code}'`,
          `SELECT * FROM team WHERE room = '${code}'`,
          `SELECT * FROM result WHERE room = '${code}'`,
        ])).connection;
        connections.push(observer);
        for (let team = 0; team < 2; team++)
          for (let role = 0; role < 3; role++)
            await clients[team][role].reducers.join({
              code,
              name: `Abandonment T${team + 1} Pilot ${role + 1}`,
              teamNumber: team,
              role,
              ruleset: RULESET,
              challenge: CHALLENGE.Easy,
              crewSize: 3,
            });
        await waitFor(
          () => [...observer.db.player.iter()].filter(player => player.room === code && player.online).length === 6,
          "two-team abandonment room did not fill",
        );
        await clients[0][0].reducers.start({});
        await waitFor(
          () => observer.db.room.id.find(code)?.state === "racing",
          "two-team abandonment room did not start",
          7000,
        );
        await Promise.all(clients[1].map(client => client.reducers.leave({})));
        await waitFor(
          () => [...observer.db.player.iter()].filter(player => player.room === code && player.team === 1)
            .every(player => !player.online),
          "abandoned team did not retain offline leases during grace",
        );

        const finishDeadline = Date.now() + 45000;
        let result;
        while (Date.now() < finishDeadline) {
          result = [...observer.db.result.iter()].find(row => row.room === code && row.team === 0);
          if (result) break;
          const row = observer.db.team.id.find(`${code}:0`);
          check(row, "connected team disappeared while its competitor was offline");
          const inputs = teammateInputs(JSON.parse(row.body));
          await Promise.all(inputs.map((input, role) => clients[0][role].reducers.input(input)));
          await wait(50);
        }
        check(result, "connected team did not finish the abandonment scenario");
        await waitFor(
          () => observer.db.room.id.find(code)?.state === "finished",
          "abandoned unfinished team blocked match completion",
        );
        check(!observer.db.team.id.find(`${code}:1`), "abandoned team row survived its grace period");
        check(
          [...observer.db.player.iter()].every(player => player.room !== code || player.team !== 1),
          "abandoned role leases survived their grace period",
        );

        await Promise.all(clients[0].map(client => client.reducers.leave({})));
        await waitFor(() => !observer.db.room.id.find(code), "finished abandonment room was not cleaned", 5000);
      } finally {
        connections.forEach(connection => connection.disconnect());
      }
    };

    const scenarios = [
      { label: "Difficult / 3-player", challenge: CHALLENGE.Difficult, crewSize: 3, exerciseReconnect: false },
      { label: "Easy / 5-player", challenge: CHALLENGE.Easy, crewSize: 5, exerciseReconnect: true },
    ];
    const results = [];
    await verifyRoomSubscriptionScope();
    await verifyReplacementConnectionOwnsLease();
    for (const scenario of scenarios) results.push(await runRoom(scenario));
    await verifyLeaderboardSubscriptionScope();
    await verifyAbandonedTeamDoesNotBlock();
    check(
      new Set(results.map(result => `${result.challenge}:${result.crewSize}`)).size === scenarios.length,
      "ranked results were not separated by challenge and crew size",
    );
    return results;
  }, { server, database });

  assert.deepEqual(
    report.map(({ challenge, crewSize }) => [challenge, crewSize]),
    [[2, 3], [0, 5]],
  );
  assert.ok(report.every(result => Number.isInteger(result.timeMs) && result.timeMs > 0));
  const uiCode = `U3${Date.now().toString(36).toUpperCase().slice(-7)}`;
  await page.waitForFunction(() => document.querySelector("#connection")?.textContent?.includes("CONNECTED"));
  await page.locator('[data-home-crew="3"]').click();
  await page.locator("#open-lobby").click();
  await page.locator("#name").fill("UI host");
  await page.locator("#code").fill(uiCode);
  await page.locator("#team").selectOption("0");
  await page.locator("#part").selectOption("0");
  await page.locator("#join").click();
  await page.waitForFunction(() => document.querySelectorAll("#members > div").length === 1);
  await page.evaluate(async ({ server, database, code }) => {
    const { DbConnection } = await import("/src/module_bindings/index.ts");
    const { CHALLENGE, RULESET } = await import("/shared/physics.ts");
    const open = () => new Promise((resolve, reject) => {
      DbConnection.builder()
        .withUri(server)
        .withDatabaseName(database)
        .onConnect(connection => resolve(connection))
        .onConnectError((_context, error) => reject(error))
        .build();
    });
    const clients = [await open(), await open()];
    window.__rankedUiClients = clients;
    await Promise.all(clients.map((connection, index) => connection.reducers.join({
      code,
      name: `UI pilot ${index + 2}`,
      teamNumber: 0,
      role: index + 1,
      ruleset: RULESET,
      challenge: CHALLENGE.Easy,
      crewSize: 3,
    })));
  }, { server, database, code: uiCode });
  await page.waitForFunction(() => document.querySelectorAll("#members > div").length === 3);
  await page.locator("#start").click();
  await page.waitForFunction(() => document.querySelector("#race-status")?.textContent === "RACING", undefined, { timeout: 8_000 });
  await page.evaluate(() => {
    const metrics = {
      mutations: 0,
      courseStage: document.querySelector("#course-stages")?.firstElementChild,
      roleCard: document.querySelector("#role-cards")?.firstElementChild,
      member: document.querySelector("#members")?.firstElementChild,
    };
    const observer = new MutationObserver(records => { metrics.mutations += records.length; });
    observer.observe(document, { attributes: true, characterData: true, childList: true, subtree: true });
    window.__rankedUiMetrics = metrics;
    window.__rankedUiObserver = observer;
  });
  await page.waitForTimeout(500);
  const rankedUi = await page.evaluate(() => new Promise(resolve => {
    requestAnimationFrame(start => {
      window.__rankedUiMetrics.mutations = 0;
      window.__rankedUiObserver.takeRecords();
      const sample = now => {
        if (now - start < 2_000) {
          requestAnimationFrame(sample);
          return;
        }
        window.__rankedUiMetrics.mutations += window.__rankedUiObserver.takeRecords().length;
        const durationMs = now - start;
        resolve({
          durationMs,
          mutationsPerSecond: window.__rankedUiMetrics.mutations * 1_000 / durationMs,
          stableCourseStage: window.__rankedUiMetrics.courseStage === document.querySelector("#course-stages")?.firstElementChild,
          stableRoleCard: window.__rankedUiMetrics.roleCard === document.querySelector("#role-cards")?.firstElementChild,
          stableMember: window.__rankedUiMetrics.member === document.querySelector("#members")?.firstElementChild,
        });
      };
      requestAnimationFrame(sample);
    });
  }));
  assert.ok(rankedUi.mutationsPerSecond <= 120, `ranked UI produced ${rankedUi.mutationsPerSecond} DOM mutations/sec`);
  assert.equal(rankedUi.stableCourseStage, true);
  assert.equal(rankedUi.stableRoleCard, true);
  assert.equal(rankedUi.stableMember, true);
  await page.locator("#exit").click();
  await page.evaluate(async () => {
    window.__rankedUiObserver.disconnect();
    await Promise.all(window.__rankedUiClients.map(connection => connection.reducers.leave({}).catch(() => {})));
    window.__rankedUiClients.forEach(connection => connection.disconnect());
  });
  console.log(
    "PASS: scoped live data, stable ranked UI, dynamic 3/5-player readiness, locks, reconnect grace, abandonment quorum, authoritative finishes, and categorized results.",
    { report, rankedUi },
  );
} finally {
  await browser.close();
}
