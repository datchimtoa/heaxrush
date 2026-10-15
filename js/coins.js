// Display authenticated server balances only; never persist or calculate Coins locally.
var coinLoadGeneration = 0;
var coinHistoryCursor = null;
var coinHistoryLoading = false;

function resetCoinDisplay() {
	coinLoadGeneration++;
	coinHistoryCursor = null;
	coinHistoryLoading = false;
	$('#coinHistory').empty();
	$('#coinBalance, #coinsHeld, #coinEarnedToday, #coinGameplayRemaining, #coinTotalRemaining').text('—');
	$('#coinDayLabel').text('');
	$('#coinBalanceRow, #coinHeldRow, #coinDailyRow, #coinMore, #resultCoins').prop('hidden', true);
	$('#coinRefresh').prop('hidden', playerAccount.state !== 'connected').prop('disabled', false);
	$('#coinMore').prop('disabled', false);
	$('#coinStatus').text(playerAccount.state === 'connected' ? 'Open Coins to load your account balance.' : 'Open from your Telegram bot to view account Coins.');
}

async function loadCoinHistory(more) {
	if (playerAccount.state !== 'connected' || coinHistoryLoading || (more && !coinHistoryCursor)) return;
	var userId = playerAccount.user.id, generation = coinLoadGeneration;
	coinHistoryLoading = true;
	$('#coinRefresh, #coinMore').prop('disabled', true);
	$('#coinStatus').text('Loading account Coins…');
	try {
		var response = await fetch('/api/coins' + (more ? '?before=' + encodeURIComponent(coinHistoryCursor) : ''), { credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(8000) });
		if (!response.ok) throw new Error('Coins unavailable');
		var data = await response.json();
		if (generation !== coinLoadGeneration || playerAccount.state !== 'connected' || playerAccount.user.id !== userId) return;
		if (!Number.isSafeInteger(data.balance) || data.balance < 0 || !Number.isSafeInteger(data.held) || data.held < 0 || !Array.isArray(data.entries)) throw new Error('Invalid Coins response');
		if (data.daily && (!['earned', 'gameplayEarned', 'totalLimit', 'gameplayLimit', 'remainingTotal', 'remainingGameplay'].every(function(key) { return Number.isSafeInteger(data.daily[key]) && data.daily[key] >= 0; }) || typeof data.daily.day !== 'string' || data.daily.timezone !== 'UTC')) throw new Error('Invalid daily Coins response');
		playerAccount.user.coinBalance = data.balance;
		playerAccount.user.coinsHeld = data.held;
		$('#coinBalance').text(data.balance.toLocaleString());
		$('#coinsHeld').text(data.held.toLocaleString());
		$('#coinBalanceRow').prop('hidden', false);
		$('#coinHeldRow').prop('hidden', data.held === 0);
		$('#coinDailyRow').prop('hidden', !data.daily || data.issuanceEnabled === false);
		if (data.daily) {
			$('#coinEarnedToday').text(data.daily.earned.toLocaleString());
			$('#coinGameplayRemaining').text(data.daily.remainingGameplay.toLocaleString() + ' / ' + data.daily.gameplayLimit.toLocaleString());
			$('#coinTotalRemaining').text(data.daily.remainingTotal.toLocaleString() + ' / ' + data.daily.totalLimit.toLocaleString());
			$('#coinDayLabel').text('· ' + data.daily.day + ' UTC');
		}
		if (!more) $('#coinHistory').empty();
		data.entries.forEach(function(entry) {
			var item = document.createElement('li');
			var description = document.createElement('div');
			var label = document.createElement('strong');
			label.textContent = entry.reason;
			var detail = document.createElement('p');
			detail.textContent = ({ earn: 'Coins added', spend: 'Coins used', hold: 'Coins reserved', release: 'Coins returned', reverse: 'Balance adjustment' }[entry.type] || 'Coin activity') + ' · ' + new Date(entry.createdAt).toLocaleString();
			description.appendChild(label); description.appendChild(detail);
			var amount = document.createElement('strong');
			amount.className = 'run-points';
			amount.textContent = (entry.type === 'earn' || entry.type === 'release' ? '+' : '−') + Number(entry.amount).toLocaleString();
			item.appendChild(description); item.appendChild(amount);
			document.getElementById('coinHistory').appendChild(item);
		});
		coinHistoryCursor = data.nextCursor;
		$('#coinMore').prop('hidden', !coinHistoryCursor);
		$('#coinStatus').text(data.issuanceEnabled === false ? 'Coin rewards are not active. Enjoy the game and chase your next best!' : 'Your Coins are up to date.');
	} catch (error) {
		if (generation === coinLoadGeneration) $('#coinStatus').text('Could not refresh Coins. You’re seeing your last balance. Retry below.');
	} finally {
		if (generation === coinLoadGeneration) {
			coinHistoryLoading = false;
			$('#coinRefresh, #coinMore').prop('disabled', false);
		}
	}
}

function showResultCoins(coins) {
	if (!coins || playerAccount.state !== 'connected' || !Number.isSafeInteger(coins.awarded) || coins.awarded < 0 || !Number.isSafeInteger(coins.balance) || coins.balance < 0 || !Number.isSafeInteger(coins.held) || coins.held < 0) { $('#resultCoins').prop('hidden', true); return; }
	playerAccount.user.coinBalance = coins.balance;
	playerAccount.user.coinsHeld = coins.held;
	$('#resultCoins').prop('hidden', false).text(coins.flagged ? 'Balance adjusted · Coins ' + coins.balance.toLocaleString() : coins.issuanceEnabled === false ? 'Coins ' + coins.balance.toLocaleString() + ' · Rewards are not active' : '+' + coins.awarded.toLocaleString() + ' Coins · Balance ' + coins.balance.toLocaleString());
}
