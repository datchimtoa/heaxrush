// Account-only invitations and display progress, never Coin eligibility.
var referralGeneration = 0;
var referralInviteLink = null;

function validReferralLink(link) {
	var telegramId = typeof link === 'string' && /\?startapp=ref_(\d{1,16})$/.exec(link);
	return typeof link === 'string' && /^https:\/\/t\.me\/[a-z][a-z0-9_]{3,31}\?startapp=ref_(?:[1-9]\d{0,15}|[a-f0-9]{32}|[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$/i.test(link) &&
		/bot\?startapp=/i.test(link) && (!telegramId || Number.isSafeInteger(Number(telegramId[1])));
}

function resetReferralDisplay() {
	referralGeneration++;
	referralInviteLink = null;
	$('#referralLink').val('');
	$('#referralInvite, #referralSummary, #referralCreate').prop('hidden', true);
	$('#referralInvited, #referralReached').text('');
	$('#referralRefresh').prop('hidden', playerAccount.state !== 'connected').prop('disabled', false);
	$('#referralCreate, #referralCopy, #referralShare').prop('disabled', false);
	$('#referralStatus').prop('hidden', false).text(playerAccount.state === 'connected' ? 'Ready to load your invites.' :
		playerAccount.state === 'connecting' ? 'Connecting to Telegram…' : playerAccount.state === 'error' ? 'Connection unavailable. Retry login in Profile.' :
		'Open Hexa Rush from the bot in Telegram to invite friends.');
}

async function loadReferrals(create) {
	resetReferralDisplay();
	if (playerAccount.state !== 'connected') return;
	var generation = referralGeneration, userId = playerAccount.user.id;
	$('#referralRefresh').prop('disabled', true);
	$('#referralStatus').text(create === true ? 'Creating your invite…' : 'Loading your invites…');
	try {
		if (create === true) {
			var created = await fetch('/api/referrals/code', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
				credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(8000) });
			if (!created.ok || !validReferralLink((await created.json()).inviteLink)) throw new Error('Invite unavailable');
			if (generation !== referralGeneration || playerAccount.state !== 'connected' || playerAccount.user.id !== userId) return;
		}
		var response = await fetch('/api/referrals', { credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(8000) });
		if (!response.ok) throw new Error('Referrals unavailable');
		var data = await response.json();
		if (generation !== referralGeneration || playerAccount.state !== 'connected' || playerAccount.user.id !== userId) return;
		if (data.rulesVersion !== HexaSessionRules.version || data.rewardsEnabled !== false || data.targetGames !== 3 ||
			(data.inviteLink !== null && !validReferralLink(data.inviteLink)) ||
			!Number.isSafeInteger(data.invitedAccounts) || data.invitedAccounts < 0 || !Number.isSafeInteger(data.reachedAccounts) ||
			data.reachedAccounts < 0 || data.reachedAccounts > data.invitedAccounts) throw new Error('Invalid referrals');
		referralInviteLink = data.inviteLink;
		$('#referralLink').val(data.inviteLink || '');
		$('#referralInvite').prop('hidden', data.inviteLink === null);
		$('#referralCreate').prop('hidden', data.inviteLink !== null);
		$('#referralSummary').prop('hidden', false);
		$('#referralInvited').text(data.invitedAccounts.toLocaleString());
		$('#referralReached').text(data.reachedAccounts.toLocaleString());
		$('#referralStatus').text(data.inviteLink === null ? 'Create your link. Invite a friend who is new to Hexa Rush.' : 'Your link is ready. Send it to a friend who is new to Hexa Rush.');
	} catch (error) {
		if (generation === referralGeneration) $('#referralStatus').text('Could not load your invites. Tap ↻ to retry.');
	} finally {
		if (generation === referralGeneration) $('#referralRefresh').prop('disabled', false);
	}
}

async function copyReferralLink() {
	if (!referralInviteLink || playerAccount.state !== 'connected' || gameState !== 0 || activeHomeTab !== 'referrals') return;
	var generation = referralGeneration;
	try {
		await navigator.clipboard.writeText(referralInviteLink);
		if (generation === referralGeneration) $('#referralStatus').text('Link copied. Your next challenger is one message away.');
	} catch (error) {
		if (generation !== referralGeneration) return;
		var field = document.getElementById('referralLink'); field.focus(); field.select();
		$('#referralStatus').text('Select the invite link below and copy it to share.');
	}
}

async function shareReferralLink() {
	if (!referralInviteLink || playerAccount.state !== 'connected' || gameState !== 0 || activeHomeTab !== 'referrals') return;
	var generation = referralGeneration;
	try {
		if (navigator.share) await navigator.share({ title: 'Hexa Rush', text: 'Rotate. Match. Beat your best. Join me in Hexa Rush!', url: referralInviteLink });
		else if (window.Telegram && window.Telegram.WebApp && window.Telegram.WebApp.openTelegramLink) {
			window.Telegram.WebApp.openTelegramLink('https://t.me/share/url?url=' + encodeURIComponent(referralInviteLink) + '&text=' + encodeURIComponent('Rotate. Match. Beat your best. Join me in Hexa Rush!'));
		} else $('#referralStatus').text('Sharing is unavailable here. Use Copy link instead.');
	} catch (error) {
		if (generation === referralGeneration) $('#referralStatus').text(error.name === 'AbortError' ? 'Share cancelled. Your invite is still available.' : 'Sharing unavailable. Use Copy link instead.');
	}
}

function initializeReferrals() {
	$('#referralRefresh').on('click', function() { loadReferrals(false); });
	$('#referralCreate').on('click', function() { loadReferrals(true); });
	$('#referralCopy').on('click', copyReferralLink);
	$('#referralShare').on('click', shareReferralLink);
	resetReferralDisplay();
	document.addEventListener('visibilitychange', function() {
		if (document.hidden) resetReferralDisplay();
		else if (gameState === 0 && activeHomeTab === 'referrals') loadReferrals(false);
	});
}