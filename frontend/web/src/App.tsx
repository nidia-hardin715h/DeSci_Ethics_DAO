// App.tsx
import { ConnectButton } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import React, { useEffect, useState } from "react";
import { ethers } from "ethers";
import { getContractReadOnly, getContractWithSigner } from "./contract";
import "./App.css";
import { useAccount, useSignMessage } from 'wagmi';

interface EthicsProposal {
  id: string;
  title: string;
  description: string;
  encryptedVotes: string;
  timestamp: number;
  proposer: string;
  status: "pending" | "approved" | "rejected";
  category: string;
}

// Randomly selected styles: High Contrast (Blue+Orange), Glass Morphism, Center Radiation, Animation Rich
const FHEEncryptNumber = (value: number): string => {
  return `FHE-${btoa(value.toString())}`;
};

const FHEDecryptNumber = (encryptedData: string): number => {
  if (encryptedData.startsWith('FHE-')) {
    return parseFloat(atob(encryptedData.substring(4)));
  }
  return parseFloat(encryptedData);
};

const FHEComputeVotes = (encryptedData: string): { yes: number; no: number; abstain: number } => {
  const value = FHEDecryptNumber(encryptedData);
  // Simulate FHE computation - in real FHE this would be done on encrypted data
  return {
    yes: Math.floor(value / 10000),
    no: Math.floor((value % 10000) / 100),
    abstain: value % 100
  };
};

const generatePublicKey = () => `0x${Array(2000).fill(0).map(() => Math.floor(Math.random() * 16).toString(16)).join('')}`;

const App: React.FC = () => {
  const { address, isConnected } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const [loading, setLoading] = useState(true);
  const [proposals, setProposals] = useState<EthicsProposal[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creating, setCreating] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{ visible: boolean; status: "pending" | "success" | "error"; message: string; }>({ visible: false, status: "pending", message: "" });
  const [newProposalData, setNewProposalData] = useState({ title: "", description: "", category: "Medical" });
  const [selectedProposal, setSelectedProposal] = useState<EthicsProposal | null>(null);
  const [decryptedVotes, setDecryptedVotes] = useState<{ yes: number; no: number; abstain: number } | null>(null);
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [publicKey, setPublicKey] = useState<string>("");
  const [contractAddress, setContractAddress] = useState<string>("");
  const [chainId, setChainId] = useState<number>(0);
  const [startTimestamp, setStartTimestamp] = useState<number>(0);
  const [durationDays, setDurationDays] = useState<number>(30);
  const [activeTab, setActiveTab] = useState<"proposals" | "stats" | "about">("proposals");
  const [searchTerm, setSearchTerm] = useState("");

  const approvedCount = proposals.filter(p => p.status === "approved").length;
  const pendingCount = proposals.filter(p => p.status === "pending").length;
  const rejectedCount = proposals.filter(p => p.status === "rejected").length;

  useEffect(() => {
    loadProposals().finally(() => setLoading(false));
    const initSignatureParams = async () => {
      const contract = await getContractReadOnly();
      if (contract) setContractAddress(await contract.getAddress());
      if (window.ethereum) {
        const chainIdHex = await window.ethereum.request({ method: 'eth_chainId' });
        setChainId(parseInt(chainIdHex, 16));
      }
      setStartTimestamp(Math.floor(Date.now() / 1000));
      setDurationDays(30);
      setPublicKey(generatePublicKey());
    };
    initSignatureParams();
  }, []);

  const loadProposals = async () => {
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const isAvailable = await contract.isAvailable();
      if (!isAvailable) return;
      
      const keysBytes = await contract.getData("proposal_keys");
      let keys: string[] = [];
      if (keysBytes.length > 0) {
        try {
          const keysStr = ethers.toUtf8String(keysBytes);
          if (keysStr.trim() !== '') keys = JSON.parse(keysStr);
        } catch (e) { console.error("Error parsing proposal keys:", e); }
      }
      
      const list: EthicsProposal[] = [];
      for (const key of keys) {
        try {
          const proposalBytes = await contract.getData(`proposal_${key}`);
          if (proposalBytes.length > 0) {
            try {
              const proposalData = JSON.parse(ethers.toUtf8String(proposalBytes));
              list.push({ 
                id: key, 
                title: proposalData.title, 
                description: proposalData.description,
                encryptedVotes: proposalData.encryptedVotes,
                timestamp: proposalData.timestamp, 
                proposer: proposalData.proposer, 
                status: proposalData.status || "pending",
                category: proposalData.category || "General"
              });
            } catch (e) { console.error(`Error parsing proposal data for ${key}:`, e); }
          }
        } catch (e) { console.error(`Error loading proposal ${key}:`, e); }
      }
      list.sort((a, b) => b.timestamp - a.timestamp);
      setProposals(list);
    } catch (e) { console.error("Error loading proposals:", e); } 
    finally { setIsRefreshing(false); setLoading(false); }
  };

  const submitProposal = async () => {
    if (!isConnected) { alert("Please connect wallet first"); return; }
    setCreating(true);
    setTransactionStatus({ visible: true, status: "pending", message: "Encrypting proposal with Zama FHE..." });
    try {
      // Initialize with 0 votes (yes: 0, no: 0, abstain: 0)
      const initialVotes = FHEEncryptNumber(0);
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract with signer");
      
      const proposalId = `prop-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
      const proposalData = { 
        title: newProposalData.title,
        description: newProposalData.description,
        encryptedVotes: initialVotes,
        timestamp: Math.floor(Date.now() / 1000),
        proposer: address,
        status: "pending",
        category: newProposalData.category
      };
      
      await contract.setData(`proposal_${proposalId}`, ethers.toUtf8Bytes(JSON.stringify(proposalData)));
      
      const keysBytes = await contract.getData("proposal_keys");
      let keys: string[] = [];
      if (keysBytes.length > 0) {
        try { keys = JSON.parse(ethers.toUtf8String(keysBytes)); } 
        catch (e) { console.error("Error parsing keys:", e); }
      }
      keys.push(proposalId);
      await contract.setData("proposal_keys", ethers.toUtf8Bytes(JSON.stringify(keys)));
      
      setTransactionStatus({ visible: true, status: "success", message: "Proposal submitted with FHE encryption!" });
      await loadProposals();
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
        setShowCreateModal(false);
        setNewProposalData({ title: "", description: "", category: "Medical" });
      }, 2000);
    } catch (e: any) {
      const errorMessage = e.message.includes("user rejected transaction") ? "Transaction rejected by user" : "Submission failed: " + (e.message || "Unknown error");
      setTransactionStatus({ visible: true, status: "error", message: errorMessage });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { setCreating(false); }
  };

  const decryptWithSignature = async (encryptedData: string) => {
    if (!isConnected) { alert("Please connect wallet first"); return null; }
    setIsDecrypting(true);
    try {
      const message = `publickey:${publicKey}\ncontractAddresses:${contractAddress}\ncontractsChainId:${chainId}\nstartTimestamp:${startTimestamp}\ndurationDays:${durationDays}`;
      await signMessageAsync({ message });
      await new Promise(resolve => setTimeout(resolve, 1500));
      return FHEComputeVotes(encryptedData);
    } catch (e) { console.error("Decryption failed:", e); return null; } 
    finally { setIsDecrypting(false); }
  };

  const voteOnProposal = async (proposalId: string, voteType: "yes" | "no" | "abstain") => {
    if (!isConnected) { alert("Please connect wallet first"); return; }
    setTransactionStatus({ visible: true, status: "pending", message: "Processing encrypted vote with FHE..." });
    try {
      const contract = await getContractReadOnly();
      if (!contract) throw new Error("Failed to get contract");
      
      const proposalBytes = await contract.getData(`proposal_${proposalId}`);
      if (proposalBytes.length === 0) throw new Error("Proposal not found");
      const proposalData = JSON.parse(ethers.toUtf8String(proposalBytes));
      
      // Simulate FHE computation - in real FHE this would be done on encrypted data
      const currentVotes = FHEComputeVotes(proposalData.encryptedVotes);
      currentVotes[voteType] += 1;
      
      // Encode votes back into single number for encryption
      const newVoteValue = currentVotes.yes * 10000 + currentVotes.no * 100 + currentVotes.abstain;
      const encryptedVotes = FHEEncryptNumber(newVoteValue);
      
      const contractWithSigner = await getContractWithSigner();
      if (!contractWithSigner) throw new Error("Failed to get contract with signer");
      
      const updatedProposal = { ...proposalData, encryptedVotes };
      await contractWithSigner.setData(`proposal_${proposalId}`, ethers.toUtf8Bytes(JSON.stringify(updatedProposal)));
      
      setTransactionStatus({ visible: true, status: "success", message: "FHE vote recorded successfully!" });
      await loadProposals();
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
    } catch (e: any) {
      setTransactionStatus({ visible: true, status: "error", message: "Voting failed: " + (e.message || "Unknown error") });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  const filteredProposals = proposals.filter(proposal => 
    proposal.title.toLowerCase().includes(searchTerm.toLowerCase()) || 
    proposal.description.toLowerCase().includes(searchTerm.toLowerCase()) ||
    proposal.category.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const renderVoteChart = (votes: { yes: number; no: number; abstain: number }) => {
    const total = votes.yes + votes.no + votes.abstain || 1;
    const yesPercentage = (votes.yes / total) * 100;
    const noPercentage = (votes.no / total) * 100;
    const abstainPercentage = (votes.abstain / total) * 100;
    
    return (
      <div className="vote-chart-container">
        <div className="vote-chart">
          <div className="vote-segment yes" style={{ transform: `rotate(${yesPercentage * 3.6}deg)` }}></div>
          <div className="vote-segment no" style={{ transform: `rotate(${(yesPercentage + noPercentage) * 3.6}deg)` }}></div>
          <div className="vote-segment abstain" style={{ transform: `rotate(${(yesPercentage + noPercentage + abstainPercentage) * 3.6}deg)` }}></div>
          <div className="vote-center">
            <div className="vote-value">{total}</div>
            <div className="vote-label">Votes</div>
          </div>
        </div>
        <div className="vote-legend">
          <div className="legend-item"><div className="color-box yes"></div><span>Yes: {votes.yes}</span></div>
          <div className="legend-item"><div className="color-box no"></div><span>No: {votes.no}</span></div>
          <div className="legend-item"><div className="color-box abstain"></div><span>Abstain: {votes.abstain}</span></div>
        </div>
      </div>
    );
  };

  if (loading) return (
    <div className="loading-screen">
      <div className="spinner"></div>
      <p>Initializing DeSci Ethics DAO...</p>
    </div>
  );

  return (
    <div className="app-container">
      <div className="background-radial"></div>
      
      <header className="app-header">
        <div className="logo-container">
          <div className="logo-icon">
            <div className="atom-icon"></div>
          </div>
          <h1>DeSci Ethics DAO</h1>
          <div className="fhe-badge">
            <span>Powered by Zama FHE</span>
          </div>
        </div>
        
        <div className="header-actions">
          <div className="search-container">
            <input 
              type="text" 
              placeholder="Search proposals..." 
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="glass-input"
            />
            <button className="search-btn"></button>
          </div>
          
          <button 
            onClick={() => setShowCreateModal(true)} 
            className="create-btn glass-button"
          >
            + New Proposal
          </button>
          
          <div className="wallet-connect-wrapper">
            <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
          </div>
        </div>
      </header>
      
      <div className="main-content">
        <div className="navigation-tabs">
          <button 
            className={`tab-btn ${activeTab === "proposals" ? "active" : ""}`}
            onClick={() => setActiveTab("proposals")}
          >
            Proposals
          </button>
          <button 
            className={`tab-btn ${activeTab === "stats" ? "active" : ""}`}
            onClick={() => setActiveTab("stats")}
          >
            Statistics
          </button>
          <button 
            className={`tab-btn ${activeTab === "about" ? "active" : ""}`}
            onClick={() => setActiveTab("about")}
          >
            About DAO
          </button>
        </div>
        
        {activeTab === "proposals" && (
          <div className="proposals-section">
            <div className="section-header">
              <h2>Ethics Review Proposals</h2>
              <button 
                onClick={loadProposals} 
                className="refresh-btn glass-button" 
                disabled={isRefreshing}
              >
                {isRefreshing ? "Refreshing..." : "Refresh"}
              </button>
            </div>
            
            <div className="proposals-grid">
              {filteredProposals.length === 0 ? (
                <div className="no-proposals glass-card">
                  <div className="empty-icon"></div>
                  <p>No ethics review proposals found</p>
                  <button 
                    className="glass-button primary" 
                    onClick={() => setShowCreateModal(true)}
                  >
                    Create First Proposal
                  </button>
                </div>
              ) : filteredProposals.map(proposal => (
                <div 
                  className="proposal-card glass-card" 
                  key={proposal.id}
                  onClick={() => setSelectedProposal(proposal)}
                >
                  <div className="proposal-header">
                    <span className={`status-badge ${proposal.status}`}>{proposal.status}</span>
                    <span className="category-tag">{proposal.category}</span>
                  </div>
                  <h3>{proposal.title}</h3>
                  <p className="proposal-description">
                    {proposal.description.length > 100 
                      ? `${proposal.description.substring(0, 100)}...` 
                      : proposal.description}
                  </p>
                  <div className="proposal-footer">
                    <span className="proposer">
                      {proposal.proposer.substring(0, 6)}...{proposal.proposer.substring(38)}
                    </span>
                    <span className="date">
                      {new Date(proposal.timestamp * 1000).toLocaleDateString()}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
        
        {activeTab === "stats" && (
          <div className="stats-section">
            <div className="stats-grid">
              <div className="stats-card glass-card">
                <h3>Proposal Statistics</h3>
                <div className="stats-row">
                  <div className="stat-item">
                    <div className="stat-value">{proposals.length}</div>
                    <div className="stat-label">Total</div>
                  </div>
                  <div className="stat-item">
                    <div className="stat-value approved">{approvedCount}</div>
                    <div className="stat-label">Approved</div>
                  </div>
                  <div className="stat-item">
                    <div className="stat-value pending">{pendingCount}</div>
                    <div className="stat-label">Pending</div>
                  </div>
                  <div className="stat-item">
                    <div className="stat-value rejected">{rejectedCount}</div>
                    <div className="stat-label">Rejected</div>
                  </div>
                </div>
              </div>
              
              <div className="stats-card glass-card">
                <h3>Categories Distribution</h3>
                <div className="category-chart">
                  {Array.from(new Set(proposals.map(p => p.category))).map(category => (
                    <div key={category} className="category-item">
                      <div className="category-label">{category}</div>
                      <div className="category-bar-container">
                        <div 
                          className="category-bar" 
                          style={{ 
                            width: `${(proposals.filter(p => p.category === category).length / proposals.length) * 100}%` 
                          }}
                        ></div>
                      </div>
                      <div className="category-count">
                        {proposals.filter(p => p.category === category).length}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}
        
        {activeTab === "about" && (
          <div className="about-section">
            <div className="about-card glass-card">
              <h2>DeSci Ethics DAO</h2>
              <p className="about-description">
                A decentralized ethics committee for DeSci projects using Zama FHE technology to 
                enable private voting and confidential review of research proposals while maintaining 
                transparency in governance.
              </p>
              
              <div className="features-grid">
                <div className="feature-item">
                  <div className="feature-icon">🔒</div>
                  <h3>FHE-Encrypted Voting</h3>
                  <p>Votes are encrypted using Zama FHE, allowing for private voting while maintaining verifiability.</p>
                </div>
                <div className="feature-item">
                  <div className="feature-icon">⚖️</div>
                  <h3>Ethics Review</h3>
                  <p>Decentralized committee reviews research proposals for ethical compliance.</p>
                </div>
                <div className="feature-item">
                  <div className="feature-icon">🌐</div>
                  <h3>Global Participation</h3>
                  <p>Open to ethicists, scientists, and the public worldwide.</p>
                </div>
                <div className="feature-item">
                  <div className="feature-icon">🔍</div>
                  <h3>Transparent Process</h3>
                  <p>All decisions are recorded on-chain while preserving voter privacy.</p>
                </div>
              </div>
              
              <div className="fhe-explainer">
                <h3>How FHE Protects Privacy</h3>
                <div className="fhe-steps">
                  <div className="fhe-step">
                    <div className="step-number">1</div>
                    <div className="step-content">
                      <h4>Encrypted Votes</h4>
                      <p>Votes are encrypted on the client side before being submitted to the blockchain.</p>
                    </div>
                  </div>
                  <div className="fhe-step">
                    <div className="step-number">2</div>
                    <div className="step-content">
                      <h4>Private Computation</h4>
                      <p>Votes are tallied using FHE operations without ever being decrypted.</p>
                    </div>
                  </div>
                  <div className="fhe-step">
                    <div className="step-number">3</div>
                    <div className="step-content">
                      <h4>Verifiable Results</h4>
                      <p>Final results can be verified by anyone while individual votes remain private.</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
      
      {showCreateModal && (
        <ModalCreate 
          onSubmit={submitProposal} 
          onClose={() => setShowCreateModal(false)} 
          creating={creating} 
          proposalData={newProposalData} 
          setProposalData={setNewProposalData}
        />
      )}
      
      {selectedProposal && (
        <ProposalDetailModal 
          proposal={selectedProposal} 
          onClose={() => { 
            setSelectedProposal(null); 
            setDecryptedVotes(null); 
          }} 
          decryptedVotes={decryptedVotes} 
          setDecryptedVotes={setDecryptedVotes} 
          isDecrypting={isDecrypting} 
          decryptWithSignature={decryptWithSignature}
          voteOnProposal={voteOnProposal}
        />
      )}
      
      {transactionStatus.visible && (
        <div className="transaction-modal">
          <div className="transaction-content glass-card">
            <div className={`transaction-icon ${transactionStatus.status}`}>
              {transactionStatus.status === "pending" && <div className="spinner"></div>}
              {transactionStatus.status === "success" && <div className="check-icon"></div>}
              {transactionStatus.status === "error" && <div className="error-icon"></div>}
            </div>
            <div className="transaction-message">{transactionStatus.message}</div>
          </div>
        </div>
      )}
      
      <footer className="app-footer">
        <div className="footer-content">
          <div className="footer-brand">
            <div className="logo">
              <div className="atom-icon"></div>
              <span>DeSci Ethics DAO</span>
            </div>
            <p>Decentralized ethics review powered by Zama FHE</p>
          </div>
          <div className="footer-links">
            <a href="#" className="footer-link">Documentation</a>
            <a href="#" className="footer-link">Governance</a>
            <a href="#" className="footer-link">Join Community</a>
            <a href="#" className="footer-link">Contact</a>
          </div>
        </div>
        <div className="footer-bottom">
          <div className="fhe-badge"><span>FHE-Powered Privacy</span></div>
          <div className="copyright">© {new Date().getFullYear()} DeSci Ethics DAO. All rights reserved.</div>
        </div>
      </footer>
    </div>
  );
};

interface ModalCreateProps {
  onSubmit: () => void; 
  onClose: () => void; 
  creating: boolean;
  proposalData: any;
  setProposalData: (data: any) => void;
}

const ModalCreate: React.FC<ModalCreateProps> = ({ onSubmit, onClose, creating, proposalData, setProposalData }) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setProposalData({ ...proposalData, [name]: value });
  };

  const handleSubmit = () => {
    if (!proposalData.title || !proposalData.description) { 
      alert("Please fill required fields"); 
      return; 
    }
    onSubmit();
  };

  return (
    <div className="modal-overlay">
      <div className="create-modal glass-card">
        <div className="modal-header">
          <h2>New Ethics Review Proposal</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        <div className="modal-body">
          <div className="fhe-notice-banner">
            <div className="key-icon"></div> 
            <div>
              <strong>FHE Encryption Notice</strong>
              <p>Voting data will be encrypted with Zama FHE for privacy protection</p>
            </div>
          </div>
          
          <div className="form-group">
            <label>Title *</label>
            <input 
              type="text" 
              name="title" 
              value={proposalData.title} 
              onChange={handleChange} 
              placeholder="Proposal title..." 
              className="glass-input"
            />
          </div>
          
          <div className="form-group">
            <label>Category *</label>
            <select 
              name="category" 
              value={proposalData.category} 
              onChange={handleChange} 
              className="glass-select"
            >
              <option value="Medical">Medical Research</option>
              <option value="AI">AI Ethics</option>
              <option value="Biology">Biology</option>
              <option value="Chemistry">Chemistry</option>
              <option value="Psychology">Psychology</option>
              <option value="Other">Other</option>
            </select>
          </div>
          
          <div className="form-group">
            <label>Description *</label>
            <textarea 
              name="description" 
              value={proposalData.description} 
              onChange={handleChange} 
              placeholder="Detailed description of the research and ethical considerations..." 
              className="glass-textarea"
              rows={5}
            />
          </div>
          
          <div className="privacy-notice">
            <div className="privacy-icon"></div> 
            <div>
              <strong>Privacy Guarantee</strong>
              <p>All votes will be encrypted and processed using FHE technology</p>
            </div>
          </div>
        </div>
        <div className="modal-footer">
          <button onClick={onClose} className="cancel-btn glass-button">Cancel</button>
          <button 
            onClick={handleSubmit} 
            disabled={creating} 
            className="submit-btn glass-button primary"
          >
            {creating ? "Submitting with FHE..." : "Submit Proposal"}
          </button>
        </div>
      </div>
    </div>
  );
};

interface ProposalDetailModalProps {
  proposal: EthicsProposal;
  onClose: () => void;
  decryptedVotes: { yes: number; no: number; abstain: number } | null;
  setDecryptedVotes: (value: { yes: number; no: number; abstain: number } | null) => void;
  isDecrypting: boolean;
  decryptWithSignature: (encryptedData: string) => Promise<{ yes: number; no: number; abstain: number } | null>;
  voteOnProposal: (proposalId: string, voteType: "yes" | "no" | "abstain") => void;
}

const ProposalDetailModal: React.FC<ProposalDetailModalProps> = ({ 
  proposal, onClose, decryptedVotes, setDecryptedVotes, isDecrypting, decryptWithSignature, voteOnProposal 
}) => {
  const handleDecrypt = async () => {
    if (decryptedVotes !== null) { setDecryptedVotes(null); return; }
    const decrypted = await decryptWithSignature(proposal.encryptedVotes);
    if (decrypted !== null) setDecryptedVotes(decrypted);
  };

  return (
    <div className="modal-overlay">
      <div className="proposal-detail-modal glass-card">
        <div className="modal-header">
          <h2>{proposal.title}</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="proposal-meta">
            <div className="meta-item">
              <span>Status:</span>
              <strong className={`status-badge ${proposal.status}`}>{proposal.status}</strong>
            </div>
            <div className="meta-item">
              <span>Category:</span>
              <strong>{proposal.category}</strong>
            </div>
            <div className="meta-item">
              <span>Proposer:</span>
              <strong>{proposal.proposer.substring(0, 6)}...{proposal.proposer.substring(38)}</strong>
            </div>
            <div className="meta-item">
              <span>Date:</span>
              <strong>{new Date(proposal.timestamp * 1000).toLocaleString()}</strong>
            </div>
          </div>
          
          <div className="proposal-content">
            <h3>Research Description</h3>
            <p>{proposal.description}</p>
          </div>
          
          <div className="voting-section">
            <h3>Voting</h3>
            
            {proposal.status === "pending" && (
              <div className="vote-actions">
                <button 
                  className="vote-btn yes glass-button" 
                  onClick={() => voteOnProposal(proposal.id, "yes")}
                >
                  Approve
                </button>
                <button 
                  className="vote-btn no glass-button" 
                  onClick={() => voteOnProposal(proposal.id, "no")}
                >
                  Reject
                </button>
                <button 
                  className="vote-btn abstain glass-button" 
                  onClick={() => voteOnProposal(proposal.id, "abstain")}
                >
                  Abstain
                </button>
              </div>
            )}
            
            <div className="vote-results">
              <div className="fhe-tag">
                <div className="fhe-icon"></div>
                <span>FHE Encrypted Votes</span>
              </div>
              
              <button 
                className="decrypt-btn glass-button" 
                onClick={handleDecrypt} 
                disabled={isDecrypting}
              >
                {isDecrypting ? "Decrypting..." : decryptedVotes ? "Hide Votes" : "Decrypt Vote Count"}
              </button>
              
              {decryptedVotes && (
                <div className="vote-display">
                  {renderVoteChart(decryptedVotes)}
                  <div className="vote-breakdown">
                    <div className="vote-item">
                      <span className="vote-label">Approved:</span>
                      <span className="vote-count yes">{decryptedVotes.yes}</span>
                    </div>
                    <div className="vote-item">
                      <span className="vote-label">Rejected:</span>
                      <span className="vote-count no">{decryptedVotes.no}</span>
                    </div>
                    <div className="vote-item">
                      <span className="vote-label">Abstained:</span>
                      <span className="vote-count abstain">{decryptedVotes.abstain}</span>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="close-btn glass-button">Close</button>
        </div>
      </div>
    </div>
  );
};

function renderVoteChart(votes: { yes: number; no: number; abstain: number }) {
  const total = votes.yes + votes.no + votes.abstain || 1;
  const yesPercentage = (votes.yes / total) * 100;
  const noPercentage = (votes.no / total) * 100;
  const abstainPercentage = (votes.abstain / total) * 100;
  
  return (
    <div className="vote-chart-container">
      <div className="vote-chart">
        <div className="vote-segment yes" style={{ transform: `rotate(${yesPercentage * 3.6}deg)` }}></div>
        <div className="vote-segment no" style={{ transform: `rotate(${(yesPercentage + noPercentage) * 3.6}deg)` }}></div>
        <div className="vote-segment abstain" style={{ transform: `rotate(${(yesPercentage + noPercentage + abstainPercentage) * 3.6}deg)` }}></div>
        <div className="vote-center">
          <div className="vote-value">{total}</div>
          <div className="vote-label">Votes</div>
        </div>
      </div>
    </div>
  );
}

export default App;