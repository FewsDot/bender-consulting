const functions = require("firebase-functions");
const fetch = require("node-fetch");
const CryptoJS = require("crypto-js");
const request = require("request");
const { RESTv2 } = require("bfx-api-node-rest");
const Twit = require("twit");
const moment = require("moment");

//Password Acces Api
const passwordAccess = "TonMotDePasseAssezSécurePlease!";
// Finex Key
const apiKeyPaperBitfinex = "TaCléApi";
const apiSecretPaperBitfinex = "EncoreTaCléApi";
// CoinAPI key
const coinApiKey = "EncoreEncoreTaCléApi";

//Finex Setting for BFX-API-NODE
const rest = new RESTv2({
	apiKey: apiKeyPaperBitfinex,
	apiSecret: apiSecretPaperBitfinex,
});

//Twitter Key
const twitterApiKey = "EncoreEncoreEncoreTaCléApi";
const twitterApiSecret = "EncoreEncoreEncoreEncoreTaCléApi";
const twitterToken = "TonTokenTwitter";
const twitterSecret = "EncoreEncoreEncoreEncoreEncoreTaCléApi";

//Get Order Function
const getOrder = () => {
	console.log("1ère étape");
	console.log("Recherche d'ordes ouverts...");
	return new Promise((resolve, reject) => {
		rest
			.activeOrders()
			.then((value) => {
				if (value.length >= 1) {
					let result = [];
					value.forEach((element) => {
						let orderId = element[0];
						result.push(orderId);
					});
					console.log("Détection d'ordres ouverts");
					resolve(result);
				} else {
					console.log("Pas d'ordres ouverts !");
					resolve(false);
				}
			})
			.catch((err) => {
				console.log(err);
			});
	});
};

//Delete Order Function
const deleteOrder = async (orders) => {
	console.log("start to erase these orders : ", orders);

	return new Promise((resolve, reject) => {
		rest
			.cancelOrders(orders)
			.then((value) => {
				resolve(value.status);
			})
			.catch((err) => {
				console.log(err);
			});
	});
};

//GetStrategy Function
const getStrategy = async () => {
	console.log("2eme Étape");
	console.log("Recherche de wallets...");

	return new Promise((resolve, reject) => {
		rest
			.wallets()
			.then((value) => {
				let walletExchange = [];
				value.forEach((element, i) => {
					if (element[0] === "exchange") {
						console.log(`Wallet ${i} identifé`);

						return walletExchange.push(element);
					} else {
						console.log("wallet ignoré car de type Margin");
					}
				});
				switch (walletExchange.length) {
					// Si le Wallet contient 1 seul actif
					case 1:
						const asset = walletExchange[0][1];
						const amount = walletExchange[0][2];
						if (asset === "TESTUSD") {
							resolve({ Strategy: "FullUSD", Asset: asset, Amount: amount });
						} else {
							resolve({ Strategy: "FullBTC", Asset: asset, Amount: amount });
						}
						break;
					// Si le Wallet contient 2 actifs
					case 2:
						const asset1 = walletExchange[0][1];
						const amount1 = walletExchange[0][2];
						const asset2 = walletExchange[1][1];
						const amount2 = walletExchange[1][2];
						// Si Montant $ est < à 10$ => On considère que wallet à juste BTC
						if (amount1 <= 10) {
							resolve({ Strategy: "FullBTC", Asset: asset2, Amount: amount2 });
						}
						// Si Montant BTC est < à 0.0005BTC => On considère que wallet contient juste $
						else if (amount2 <= 5 / 10000) {
							resolve({ Strategy: "FullUSD", Asset: asset1, Amount: amount1 });
						}
						// Sinon, On considère vraiment que wallet contient juste deux actifs
						else {
							resolve({
								Strategy: "FiftyFifty",
								Asset: asset1,
								Amount: amount1,
								Asset2: asset2,
								Amount2: amount2,
							});
						}
						break;
					default:
				}
			})
			.catch((err) => {
				console.log(err);
			});
	});
};

//GetTrendAndPrice
const getTrendAndPrice = async (strategy) => {
	console.log("resultat de l'Analyse de stratégie :", strategy);
	console.log("3ème Étape");
	console.log("Analyse de la Tendance et récuperation de l'ATH");

	const urlCoinApi = "https://rest.coinapi.io/v1/ohlcv/";
	const tickerHistory = "BITMEX_PERP_BTC_USD/history?";
	const queries = "period_id=7DAY&time_start=2017-12-01T00:00:00&limit=1000";

	const req = await fetch(`${urlCoinApi}${tickerHistory}${queries}`, {
		headers: {
			"X-CoinAPI-Key": coinApiKey,
			Accept: "application/json",
			"Accept-Encoding": "deflate, gzip",
		},
	});

	const response = await req.json();
	let result = [];

	if (response.error) {
		console.log(`Erreur CoinAPi : ${response.error}.`);
	} else {
		const arrayOrdered = response.sort(function (a, b) {
			return parseFloat(b.price_high) - parseFloat(a.price_high);
		});
		const arraySliced = arrayOrdered.slice(0, 2);
		const arrayDone = arraySliced.map((item) => {
			return { weeklyATH: item.price_high, candleClosedDate: item.time_close };
		});
		const historicalATH = arrayDone[0].weeklyATH;
		const firstATHDate = Date.parse(arrayDone[0].candleClosedDate);
		const secondATHDate = Date.parse(arrayDone[1].candleClosedDate);

		if (firstATHDate > secondATHDate) {
			result.push({ isUpTrend: true, historicalATH: historicalATH, Strategy: strategy });
			return result;
		} else {
			result.push({ isUpTrend: false, historicalATH: historicalATH, Strategy: strategy });
			return result;
		}
	}
};

// GetLastBuyPrice Function
const getLastBuyPrice = () => {
	const apiPath = "v2/auth/r/trades/hist";
	const nonce = (Date.now() * 1000).toString();
	const body = {};
	let signature = `/api/${apiPath}${nonce}${JSON.stringify(body)}`;
	const sig = CryptoJS.HmacSHA384(signature, apiSecretPaperBitfinex).toString();

	const options = {
		url: `https://api.bitfinex.com/${apiPath}`,
		headers: {
			"bfx-nonce": nonce,
			"bfx-apikey": apiKeyPaperBitfinex,
			"bfx-signature": sig,
		},
		body: body,
		json: true,
	};
	console.log("Recherche du dernier prix d'achat..");

	return new Promise((resolve, reject) => {
		request.post(options, (error, response, body) => {
			if (body) {
				let lastBuyPrice = body[0][5];
				console.log("Dernier prix d'achat : ", lastBuyPrice);
				resolve(lastBuyPrice);
			} else {
				reject(`Erreur dans la recherche du dernier prix d'achat ! dernier prix d'achat : ${body}`);
			}
		});
	});
};

//BuildOrder Function
const buildOrder = (orderData) => {
	const apiPath = "v2/auth/w/order/submit";

	const nonce = (Date.now() * 1000).toString();
	let body = {};

	orderData.type === "TP/SL"
		? (body = {
				type: "EXCHANGE LIMIT",
				symbol: "tTESTBTC:TESTUSD",
				price: orderData.priceTP,
				amount: orderData.amount,
				flags: 16384,
				price_oco_stop: orderData.priceSL,
		  })
		: (body = {
				type: "EXCHANGE LIMIT",
				symbol: "tTESTBTC:TESTUSD",
				price: orderData.buyPrice,
				amount: orderData.amount,
		  });
	let signature = `/api/${apiPath}${nonce}${JSON.stringify(body)}`;

	const sig = CryptoJS.HmacSHA384(signature, apiSecretPaperBitfinex).toString();
	console.log("order data", orderData);

	const options = {
		url: `https://api.bitfinex.com/${apiPath}`,
		headers: {
			"bfx-nonce": nonce,
			"bfx-apikey": apiKeyPaperBitfinex,
			"bfx-signature": sig,
		},
		body: body,
		json: true,
	};
	console.log("5ème étape");
	console.log("Construction de l'ordre en fonction de la stratégie...");

	return new Promise((resolve, reject) => {
		request.post(options, (error, response, body) => {
			if (body[0] === "error") {
				resolve(`Erreur lors de la soumission de l'ordre : ${body[2]}`);
			} else {
				let status = body[6];
				resolve(status);
			}
		});
	});
};

// PostTweet Function
const postTweet = async (toTweet) => {
	console.log("6ème Étape");
	console.log("Préparation du Tweet");
	const req = await fetch(
		"https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd"
	);
	const response = await req.json();

	const btcPrice = response.bitcoin.usd;
	const today = `${new Date().getDate()}/${new Date().getMonth()}/${new Date().getFullYear()}`;
	const trend = toTweet.datas[0].isUpTrend === false ? "Baissière🐻" : "Haussière🐃";
	const strategy = toTweet.datas[0].Strategy.Strategy;
	const order = toTweet.order;
	const status = toTweet.status;
	const startCapital = 10000;
	const amountBTC = (strategy) => {
		let result;
		if (strategy === "FiftyFifty") {
			result = toTweet.datas[0].Strategy.Amount2.toFixed(4);
			return result;
		} else if (strategy === "FullUSD") {
			result = 0;
			return result;
		} else {
			result = toTweet.datas[0].Strategy.Amount.toFixed(4);
			return result;
		}
	};
	const amountUSD = (strategy) => {
		let result;
		if (strategy === "FiftyFifty") {
			result = toTweet.datas[0].Strategy.Amount.toFixed(2);
			return result;
		} else if (strategy === "FullBTC") {
			result = 0;
			return result;
		} else {
			result = toTweet.datas[0].Strategy.Amount.toFixed(2);
			return result;
		}
	};

	const btcToUsd = btcPrice * amountBTC(strategy);
	const totalWalletValue = parseInt(btcToUsd.toFixed(2)) + parseInt(amountUSD(strategy));
	const performance = totalWalletValue - startCapital;
	const startSince = () => {
		let todayToConvert = moment([
			new Date().getFullYear(),
			new Date().getMonth(),
			new Date().getDate(),
		]);
		let startDateToConvert = moment([2020, 7, 17]);
		let finalResult = todayToConvert.diff(startDateToConvert, "days");
		return finalResult + " Jours";
	};
	console.log("Initiaition du BOT Twiter");

	var T = new Twit({
		consumer_key: twitterApiKey,
		consumer_secret: twitterApiSecret,
		access_token: twitterToken,
		access_token_secret: twitterSecret,
	});

	console.log("Texte du Tweet");
	let TextTweet = `Analyse #Bitcoin - ${today} :
	Prix : ${btcPrice}💲
	Trend : ${trend}
	Strategy : ${strategy}📉📈
	Wallet : ${amountBTC(strategy)} ₿ & ${amountUSD(strategy)} $💰
	${order}📗
	Statut : ${status === "SUCCESS" ? "✅" : "❌"}
	En ${startSince()}, ${startCapital}$ ==> ${totalWalletValue}$ soit : ${
		performance >= 1 ? "+" + performance + "$🤑" : "-" + performance + "$🤭"
	}
	Ciao bande de nazes !🤙
	$BTC #BTC`;

	T.post("statuses/update", { status: TextTweet }, function (err, data, response) {
		if (err) {
			console.log("Erreur dans l'envoi du Tweet : ", err);
		}
		console.log("Tweet bien envoyé !");
	});
	console.log(TextTweet);
};

//Submit Order Function
const submitOrder = async (trend) => {
	console.log("Récuperation effectuée");
	console.log("resultat récupération données : ", trend);
	console.log("4eme Étape");
	console.log("Placement des ordres..");

	if (trend) {
		const isUpTrend = trend[0].isUpTrend;
		const ATH = trend[0].historicalATH;
		const Strategy = trend[0].Strategy.Strategy;
		const Asset = trend[0].Strategy.Asset;
		const Amount = trend[0].Strategy.Amount;
		let buyPrice;
		let takeProfitPrice;
		let stopLossPrice;
		let amountFixed;
		let fiftyAmount;
		let amountConverted;
		let message;
		let toTweet;

		return new Promise((resolve, reject) => {
			if (isUpTrend === true) {
				switch (Strategy) {
					case "FullUSD":
						//Order Buy à - 25% du firstATH // Montant : 100% USD
						buyPrice = ATH * 0.75;
						amountFixed = (Amount * 0.99).toFixed(4);
						amountConverted = amountFixed / buyPrice;
						message = `Stratégie Haussière ${Strategy} : mettre order buy à ${buyPrice} de ${amountConverted} BTC`;
						console.log(message);
						buildOrder({
							type: "BUY",
							amount: amountConverted.toFixed(4).toString(),
							buyPrice: buyPrice.toString(),
						}).then((orderReport) => {
							toTweet = {
								datas: trend,
								order: `Order Buy ${amountConverted.toFixed(4)}₿ à ${buyPrice}`,
								status: orderReport,
							};
							postTweet(toTweet);
						});
						break;
					case "FullBTC":
						//Order Sell à +98% du dernier prix d'achat  // Montant : 50% BTC
						//Order Sell à -20% du dernier prix d'achat // Montant 50% BTC
						getLastBuyPrice().then((lastBuyPrice) => {
							takeProfitPrice = lastBuyPrice * 1.98;
							fiftyAmount = (Amount / 2).toFixed(4);
							stopLossPrice = lastBuyPrice * 0.8;
							message = `Stratégie Haussière ${Strategy} : Mettre un Take Profit à ${takeProfitPrice} & Un Stop Loss à ${stopLossPrice} de ${fiftyAmount}${Asset}`;

							console.log(message);
							buildOrder({
								type: "TP/SL",
								amount: "-" + fiftyAmount.toString(),
								priceTP: takeProfitPrice.toString(),
								priceSL: stopLossPrice.toString(),
							}).then((orderReport) => {
								toTweet = {
									datas: trend,
									order: `TakeProfit à ${takeProfitPrice}$ & StopLoss à ${stopLossPrice}$ pour ${fiftyAmount}₿`,
									status: orderReport,
								};
								postTweet(toTweet);
							});
						});
						break;
					case "FiftyFifty":
						//Order Buy à -38% de firstATH // Montant : 100% USD
						buyPrice = ATH * 0.62;
						amountFixed = (Amount * 0.99).toFixed(4);
						amountConverted = amountFixed / buyPrice;
						message = `Stratégie Haussière ${Strategy} : mettre order buy à ${buyPrice} de ${amountConverted} BTC`;
						console.log(message);
						buildOrder({
							type: "BUY",
							amount: amountConverted.toFixed(4).toString(),
							buyPrice: buyPrice.toString(),
						}).then((orderReport) => {
							toTweet = {
								datas: trend,
								order: `Order Buy ${amountConverted.toFixed(4)}₿ à ${buyPrice}`,
								status: orderReport,
							};
							postTweet(toTweet);
						});
						break;
					default:
				}
			} else {
				switch (Strategy) {
					case "FullUSD":
						//Order Buy à -78% de firstATH  //  Montant : 100% USD
						buyPrice = ATH * 0.22;
						amountFixed = (Amount * 0.99).toFixed(2);
						amountConverted = amountFixed / buyPrice;
						message = `Stratégie Baissière ${Strategy} : mettre un order buy à ${buyPrice} de ${amountConverted}BTC`;
						console.log(message);
						buildOrder({
							type: "BUY",
							amount: amountConverted.toFixed(4).toString(),
							buyPrice: buyPrice.toString(),
						}).then((orderReport) => {
							toTweet = {
								datas: trend,
								order: `Order Buy ${amountConverted.toFixed(4)}₿ à ${buyPrice}`,
								status: orderReport,
							};
							postTweet(toTweet);
						});
						break;
					case "FullBTC":
						//Order Sell à +98% du dernier prix d'achat  // Montant : 100% BTC
						//Order Sell à -30% du dernier prix d'achat // Montant 100% BTC
						getLastBuyPrice().then((lastBuyPrice) => {
							takeProfitPrice = lastBuyPrice * 1.98;
							amountFixed = (Amount * 0.99).toFixed(4);
							stopLossPrice = lastBuyPrice * 0.7;
							message = `Stratégie Baissière ${Strategy} : Mettre un Take Profit à ${takeProfitPrice} & Un Stop Loss à ${stopLossPrice} de ${amountFixed}${Asset}`;
							console.log(message);
							buildOrder({
								type: "TP/SL",
								amount: "-" + amountFixed.toString(),
								priceTP: takeProfitPrice.toString(),
								priceSL: stopLossPrice.toString(),
							}).then((orderReport) => {
								toTweet = {
									datas: trend,
									order: `TakeProfit à ${takeProfitPrice}$ & StopLoss à ${stopLossPrice}$ pour ${amountFixed}₿`,
									status: orderReport,
								};
								postTweet(toTweet);
							});
						});

						break;
					case "FiftyFifty":
						//Order Buy à -78% de firstATH // Montant : 100% USD
						buyPrice = ATH * 0.22;
						amountFixed = (Amount * 0.99).toFixed(2);
						amountConverted = amountFixed / buyPrice;
						message = `Stratégie Baissière ${Strategy} : mettre un order buy à ${buyPrice} de ${amountConverted}₿`;
						console.log(message);
						buildOrder({
							type: "BUY",
							amount: amountConverted.toFixed(4).toString(),
							buyPrice: buyPrice.toString(),
						}).then((orderReport) => {
							toTweet = {
								datas: trend,
								order: `Order Buy ${amountConverted.toFixed(4)}₿ à ${buyPrice}$`,
								status: orderReport,
							};
							postTweet(toTweet);
						});
						break;
					default:
				}
			}
		});
	} else {
		console.log("Trend is undefined. It is not possible to submit order.");
	}
};

const runtimeOpts = {
	timeoutSeconds: 300,
	memory: "1GB",
};

exports.getAnalyseAndTweet = functions.runWith(runtimeOpts).https.onRequest((req, res) => {
	functions.logger.info("Hello logs!", { structuredData: true });
	let password = req.query.password;

	if (passwordAccess === password) {
		try {
			getOrder()
				.then((value) => {
					if (value) {
						deleteOrder(value).then((isSucces) => {
							if (isSucces === "SUCCESS") {
								console.log("Delete order status : ", isSucces);
								getStrategy().then((strategy) => {
									getTrendAndPrice(strategy).then((trend) => {
										submitOrder(trend);
									});
								});
							} else {
								console.log("Delete order fail : ", isSucces);
							}
						});
					} else {
						getStrategy().then((strategy) => {
							getTrendAndPrice(strategy).then((trend) => {
								submitOrder(trend);
							});
						});
					}
				})
				.then(res.status(200).send("Fin du Script."));
		} catch (err) {
			console.log(err);
		}
	} else {
		console.log("Mauvais Password. Acces Interdit !");
		res.status(400).send("Mauvais Password. Acces Interdit !");
	}
});
