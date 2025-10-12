# FAQ: Understanding SSV as an ETH Accrual Token

## 1. What is an ETH Accrual Token?
An **ETH Accrual Token** is a token whose value comes from **real ETH cash flows** — not speculation or inflationary rewards.  
In SSV’s case, users pay **ETH network fees** when registering validators, and those fees will eventually accrue to **SSV stakers**, making SSV directly tied to Ethereum’s validator economy.  

It’s a new paradigm where:  
**Ethereum activity → ETH fees → SSV holders**

📖 Read more: [Making SSV an ETH Accrual Token](https://alonmuroch-65570.medium.com/making-ssv-an-eth-accrual-token-d5e839fb24c0)

---

## 2. What is the SSV Network Fee?
The **SSV network fee** is a **1% fee paid in ETH** by users when they register validators on the SSV Network.  
It’s **not taken from validator rewards** — it’s a protocol-level fee for using SSV infrastructure.  
All fees go to the **SSV DAO Treasury**, and once staking launches, they’ll be distributed to **SSV stakers**.

---

## 3. How does SSV staking work?
**SSV staking is not yet live** — it requires **DAO approval** before activation.  
Once approved:

- SSV stakers will earn **ETH from network fees** proportionally to their stake  
- Stakers will serve as the network’s **first-responder backstop**, enhancing protocol security  
- ETH fees paid by users will flow directly to stakers, creating a **real-yield ETH accrual loop**

In short, SSV staking will turn the token from a coordination asset into a **yield-bearing ETH Accrual Token**.

---

## 4. How much network fee does SSV charge?
SSV currently charges a **1% network fee**, paid in ETH.  
There are **no current plans to increase it** — the focus is on stability and encouraging validator adoption.  

This ETH-based fee model ensures the system accrues real, sustainable value directly in Ethereum terms.

---

## 5. What changes will operators and users see?
**For operators:**

- Operator service fees can be set in **ETH or SSV**  
- However, the **Incentivized Mainnet** will reward **only ETH-paying clusters** — encouraging everyone to migrate to ETH payments  
- Accounting becomes simpler and more aligned with Ethereum’s base asset  

**For users:**

- You continue to pay the network fee when registering validators — as before  
- Validator rewards remain unchanged  
- When SSV staking goes live, ETH fees will start flowing to SSV stakers  

---

## 6. How does the calculator work?
The calculator estimates how much **ETH value accrues to SSV stakers** under different assumptions about ETH price, staking yield, and network size.

### Inputs
| Input | Description |
|-------|--------------|
| **ETH Price** | Current price of ETH in USD |
| **ETH Staking APR** | Annual yield validators earn on staked ETH |
| **Staked ETH** | Total ETH secured through SSV validators |
| **SSV Price** | Market price of SSV in USD |
| **Staked SSV (%)** | Percentage of total SSV supply staked |
| **SSV Network Fee** | Protocol fee (currently 1%) |

---

### Formulas

**1️⃣ Total ETH Fees Generated**
```
Total Fees = Staked ETH * ETH Price * ETH Staking APR * SSV Network Fee
```

This represents the **total ETH value flowing into the SSV network** annually.

**2️⃣ SSV Staking APR**
```
SSV Staking APR = Total Fees / (Staked SSV * SSV Price)
```

This gives the **annualized ETH yield (in %)** that each staked SSV could theoretically earn.

---

### Example

If:  
- 5,000,000 ETH is staked  
- ETH price = $3,000  
- ETH staking APR = 4%  
- Network fee = 1%  
- SSV price = $40  
- 60% of all SSV is staked  

Then:

```
Total Fees = 5,000,000 * 3,000 * 0.04 * 0.01 = 6,000,000
```

```
SSV Staking APR = 6,000,000 / (0.6 * 10,000,000 * 40) = 2.5%
```

So under these assumptions, **SSV stakers could earn ~2.5% APR in ETH value**.

---

## 7. What is the utility of staked SSV?
When staking launches, bonded SSV will not only earn ETH fees — it also acts as a **backstop if the protocol causes user losses**.  
Should a critical failure or coordinated operator issue lead to slashed validators or lost funds, the treasury can draw on staked SSV (via slashing or insurance mechanisms) to make users whole.

This design:

- Aligns stakers with the long-term reliability of the protocol  
- Incentivizes delegating to high-quality, redundant operator sets  
- Gives users confidence that the network keeps “skin in the game” for catastrophic events  

In short, staked SSV is both a **yield-bearing ETH accrual asset** and a **safety cushion** for the ecosystem.

---

## TL;DR
SSV turns validator network activity into **ETH-denominated cash flow** for stakers — making it the first **ETH Accrual Token** powering Ethereum’s validator economy.
