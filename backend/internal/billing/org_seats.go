package billing

// MinOrgSeatQuantity is the minimum number of Seats billed for an Organisation
// each cycle, even when fewer members are active (spec: organisations §5.7).
const MinOrgSeatQuantity int64 = 3

// BilledOrgSeatQuantity returns how many Seats an Organisation should be billed
// for given its active member count. Usage is pooled across those Seats.
func BilledOrgSeatQuantity(activeMembers int64) int64 {
	if activeMembers < MinOrgSeatQuantity {
		return MinOrgSeatQuantity
	}
	return activeMembers
}

// ClampOrgSeatQuantity enforces MinOrgSeatQuantity on a Paddle-reported quantity.
func ClampOrgSeatQuantity(reported int64) int64 {
	if reported < MinOrgSeatQuantity {
		return MinOrgSeatQuantity
	}
	return reported
}
