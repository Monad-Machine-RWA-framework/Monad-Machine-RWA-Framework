import { expect } from "chai";
import { ethers } from "hardhat";

const NONE = "0x0000";

describe("IdentityRegistry + ComplianceModule", () => {
  async function deploy() {
    const [admin, alice, bob] = await ethers.getSigners();
    const registry = await (
      await ethers.getContractFactory("IdentityRegistry")
    ).deploy(admin.address);
    const compliance = await (
      await ethers.getContractFactory("ComplianceModule")
    ).deploy(admin.address, await registry.getAddress());
    return { admin, alice, bob, registry, compliance };
  }

  function group(s: string): string {
    const b = ethers.toUtf8Bytes(s);
    const p = new Uint8Array(2);
    p.set(b);
    return ethers.hexlify(p);
  }

  it("verifies a registered, unfrozen, unexpired wallet", async () => {
    const { alice, registry, compliance } = await deploy();
    await registry.registerIdentity(
      alice.address,
      "CV1",
      30,
      0,
      group("AA"),
      NONE,
      0,
      ethers.ZeroHash
    );
    expect(await compliance.verify(alice.address)).to.equal(true);
  });

  it("rejects unknown and frozen wallets", async () => {
    const { alice, bob, registry, compliance } = await deploy();
    expect(await compliance.verify(bob.address)).to.equal(false); // unknown
    await registry.registerIdentity(alice.address, "CV1", 30, 0, NONE, NONE, 0, ethers.ZeroHash);
    await registry.setFrozen(alice.address, true, "test");
    expect(await compliance.verify(alice.address)).to.equal(false);
  });

  it("enforces min tier and group rules", async () => {
    const { alice, bob, registry, compliance } = await deploy();
    await registry.registerIdentity(alice.address, "CV1", 30, 0, group("AA"), NONE, 0, ethers.ZeroHash);
    await registry.registerIdentity(bob.address, "CV2", 3, 0, group("BB"), NONE, 0, ethers.ZeroHash);
    await compliance.setRule({
      allowedGroup: group("AA"),
      allowedSubGroup: NONE,
      minTier: 5,
      minSubTier: 0,
    });
    expect(await compliance.verify(alice.address)).to.equal(true); // tier 30, group AA
    expect(await compliance.verify(bob.address)).to.equal(false); // tier 3 < 5, group BB
  });

  it("reverts verify when the pool is paused", async () => {
    const { alice, registry, compliance } = await deploy();
    await registry.registerIdentity(alice.address, "CV1", 30, 0, NONE, NONE, 0, ethers.ZeroHash);
    await compliance.setPaused(true);
    await expect(compliance.verify(alice.address)).to.be.revertedWith(
      "ComplianceModule: pool paused"
    );
  });
});
